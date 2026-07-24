"""DataBus — typed payload routing between nodes.

Routing strategy by payload kind:
    * pandas DataFrames small enough to keep resident (deep memory usage at
      or below ``NOTEBOOKFLOW_SPILL_THRESHOLD_BYTES``, default 8 MB) → held
      in memory as a defensive deep copy; get() hands each consumer its own
      deep copy so mutation isolation matches the spill path exactly.
    * larger pandas DataFrames → spilled to Parquet, materialized on get().
    * Primitives (int/float/str/bool/None/dict/list) → JSON-compatible
      values kept in memory.
    * Anything else → ``TypeError`` for now. ``fileref`` kind is reserved
      for a future iteration (e.g. arbitrary large blobs the executor
      writes to disk directly).

Multi-tenant / multi-run isolation:
    Every DataBus instance carries a ``tenant`` and a ``pipeline_run_id``
    (auto-generated UUID when not supplied). Store keys are namespaced
    ``(tenant, run_id, node_id, port)`` and spill files land under
    ``spill_dir/<tenant>/<run_id>/``, so concurrent runs from different users
    never collide — even when the client-supplied run id happens to match.
    ``tenant=None`` (self-host / unauthenticated) maps to a single shared
    namespace, so old call sites that just instantiate
    ``DataBus(spill_dir=...)`` keep working unchanged.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import pandas as pd

PayloadKind = Literal["dataframe", "json", "fileref"]

_PRIMITIVE_TYPES: tuple[type, ...] = (int, float, str, bool, type(None), dict, list)

# Immutable scalars: always JSON-serializable, so put() skips the json.dumps
# round-trip and get() skips the pointless deepcopy for these.
_SCALAR_TYPES: tuple[type, ...] = (bool, int, float, str, type(None))

# DataFrames whose deep memory usage is at or below this many bytes stay in
# memory instead of spilling to Parquet (a deep copy costs a few ms at 8 MB,
# vs ~100+ ms for a parquet write + read round-trip). Overridable via the
# NOTEBOOKFLOW_SPILL_THRESHOLD_BYTES environment variable; set it to 0 to
# force every DataFrame to spill (escape hatch restoring the old behavior,
# e.g. when engine memory is tight).
_DEFAULT_SPILL_THRESHOLD_BYTES = 8_000_000
_SPILL_THRESHOLD_ENV = "NOTEBOOKFLOW_SPILL_THRESHOLD_BYTES"


def _spill_threshold_from_env() -> int:
    raw = os.environ.get(_SPILL_THRESHOLD_ENV)
    if raw is None or raw.strip() == "":
        return _DEFAULT_SPILL_THRESHOLD_BYTES
    try:
        return max(0, int(raw))
    except ValueError:
        return _DEFAULT_SPILL_THRESHOLD_BYTES


@dataclass(slots=True)
class Payload:
    kind: PayloadKind
    value: Any  # materialized data, file path, or JSON-compatible value
    meta: dict[str, Any] = field(default_factory=dict)


def _tenant_namespace(tenant: str | None) -> str:
    """Filesystem-safe, collision-resistant namespace for a tenant. ``None`` /
    empty (self-host) maps to the shared ``"_"`` namespace; an authenticated
    user id is hashed so the raw ``sub`` never lands on disk."""
    if not tenant:
        return "_"
    return hashlib.sha256(tenant.encode("utf-8")).hexdigest()[:16]


class DataBus:
    """In-memory store for node outputs, spilling large DataFrames to Parquet."""

    def __init__(
        self,
        spill_dir: Path,
        pipeline_run_id: str | None = None,
        tenant: str | None = None,
    ) -> None:
        self._spill_dir = spill_dir
        self._run_id = pipeline_run_id if pipeline_run_id else uuid.uuid4().hex
        self._tenant = _tenant_namespace(tenant)
        # Snapshotted once per bus; see _SPILL_THRESHOLD_ENV (0 = always spill).
        self._spill_threshold_bytes = _spill_threshold_from_env()
        # Internal store keeps the *stored* form: spilled DataFrames as Path
        # objects, small DataFrames as put-time deep copies. get() materializes
        # back into a Payload whose value is a fresh DataFrame either way.
        # Keys are (tenant, run_id, node_id, port) so concurrent runs from
        # different users can share one bus without colliding.
        self._store: dict[tuple[str, str, str, str], Payload] = {}

    @property
    def pipeline_run_id(self) -> str:
        return self._run_id

    @property
    def tenant(self) -> str:
        """This bus's tenant namespace (``"_"`` for self-host)."""
        return self._tenant

    @property
    def spill_root(self) -> Path:
        """Subdirectory where this run's parquet spills live (per tenant)."""
        return self._spill_dir / self._tenant / self._run_id

    def put(self, node_id: str, port: str, value: Any) -> None:
        key = (self._tenant, self._run_id, node_id, port)
        if isinstance(value, pd.DataFrame):
            meta = {"rows": len(value), "columns": list(value.columns)}
            size_bytes = int(value.memory_usage(deep=True).sum())
            if 0 < size_bytes <= self._spill_threshold_bytes:
                # Small frame: keep it resident. Deep-copy at put time so a
                # producer mutating its frame afterwards can't change what
                # consumers read — the parquet path snapshots at put time via
                # the file write, and the in-memory path must match that.
                stored = value.copy(deep=True)
                self._unlink_replaced_spill(key)
                self._store[key] = Payload(kind="dataframe", value=stored, meta=meta)
                return
            run_dir = self.spill_root
            run_dir.mkdir(parents=True, exist_ok=True)
            path = run_dir / f"{uuid.uuid4().hex}.parquet"
            value.to_parquet(path)
            self._unlink_replaced_spill(key)
            self._store[key] = Payload(kind="dataframe", value=path, meta=meta)
            return

        if isinstance(value, _PRIMITIVE_TYPES):
            # Scalars are JSON-serializable by construction; only containers
            # need the json.dumps round-trip to validate their contents.
            if not isinstance(value, _SCALAR_TYPES):
                try:
                    json.dumps(value)
                except (TypeError, ValueError) as exc:
                    raise TypeError(
                        f"Value for {node_id!r}.{port!r} is not JSON-serializable"
                    ) from exc
            self._unlink_replaced_spill(key)
            self._store[key] = Payload(kind="json", value=value, meta={})
            return

        raise TypeError(
            f"Unsupported payload type for {node_id!r}.{port!r}: {type(value).__name__}"
        )

    def _unlink_replaced_spill(self, key: tuple[str, str, str, str]) -> None:
        """Best-effort removal of the parquet file behind a key being
        overwritten, so re-``put``-ing a port doesn't leak spill files until
        ``clear_run``. Covers every replacement transition: spill→spill and
        spill→memory unlink the old file here; memory→anything has no file to
        remove (in-memory DataFrame payloads hold a DataFrame, not a Path, so
        the isinstance check skips them). Called only once the replacement
        value is validated, so a failing put never destroys the previous
        payload."""
        previous = self._store.get(key)
        if (
            previous is not None
            and previous.kind == "dataframe"
            and isinstance(previous.value, Path)
        ):
            previous.value.unlink(missing_ok=True)

    def get(self, node_id: str, port: str) -> Payload:
        key = (self._tenant, self._run_id, node_id, port)
        if key not in self._store:
            raise KeyError(f"No payload stored for {node_id!r}.{port!r}")
        payload = self._store[key]
        if payload.kind == "dataframe":
            if isinstance(payload.value, Path):
                df = pd.read_parquet(payload.value)
            else:
                # In-memory frame: every consumer gets its own deep copy so
                # in-place mutation never leaks across fan-out branches --
                # exactly the isolation the parquet re-read provides.
                df = payload.value.copy(deep=True)
            return Payload(kind="dataframe", value=df, meta=dict(payload.meta))
        # JSON payloads are stored by reference. Deep-copy containers on read
        # so that a node fanning out to several consumers gives each an
        # independent value -- one branch mutating a list/dict in place must
        # not leak into a sibling branch reading the same cached output.
        # Immutable scalars are returned as-is (deepcopy would be a no-op).
        value = payload.value
        if not isinstance(value, _SCALAR_TYPES):
            value = copy.deepcopy(value)
        return Payload(
            kind=payload.kind,
            value=value,
            meta=dict(payload.meta),
        )

    def clear_node(self, node_id: str) -> None:
        keys_to_drop = [
            k
            for k in self._store
            if k[0] == self._tenant and k[1] == self._run_id and k[2] == node_id
        ]
        for key in keys_to_drop:
            payload = self._store[key]
            if (
                payload.kind == "dataframe"
                and isinstance(payload.value, Path)
                and payload.value.exists()
            ):
                payload.value.unlink()
            del self._store[key]

    def clear_run(self) -> None:
        """Drop every key + spilled file owned by this tenant's run."""
        for key in [k for k in self._store if k[0] == self._tenant and k[1] == self._run_id]:
            payload = self._store[key]
            if (
                payload.kind == "dataframe"
                and isinstance(payload.value, Path)
                and payload.value.exists()
            ):
                payload.value.unlink()
            del self._store[key]
        run_dir = self.spill_root
        if run_dir.is_dir() and not any(run_dir.iterdir()):
            run_dir.rmdir()
        tenant_dir = self._spill_dir / self._tenant
        if tenant_dir.is_dir() and not any(tenant_dir.iterdir()):
            tenant_dir.rmdir()

    def keys(self) -> list[tuple[str, str]]:
        """All (node_id, port) keys stored for this tenant's run. For tests."""
        return [
            (node_id, port)
            for tenant, run_id, node_id, port in self._store
            if tenant == self._tenant and run_id == self._run_id
        ]
