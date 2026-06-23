"""DataBus — typed payload routing between nodes.

Routing strategy by payload kind:
    * pandas DataFrames → spilled to Parquet, materialized on get().
    * Primitives (int/float/str/bool/None/dict/list) → JSON-compatible
      values kept in memory.
    * Anything else → ``TypeError`` for now. ``fileref`` kind is reserved
      for a future iteration (e.g. arbitrary large blobs the executor
      writes to disk directly).

Multi-run isolation:
    Every DataBus instance carries a ``pipeline_run_id`` (auto-generated
    UUID when not supplied). Spill files land under ``spill_dir/<run_id>/``
    and in-memory store keys are namespaced with the run id, so a single
    shared DataBus can safely host concurrent pipeline runs without
    collisions. Old single-tenant call sites that just instantiate
    ``DataBus(spill_dir=...)`` keep working unchanged.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import pandas as pd

PayloadKind = Literal["dataframe", "json", "fileref"]

_PRIMITIVE_TYPES: tuple[type, ...] = (int, float, str, bool, type(None), dict, list)


@dataclass(slots=True)
class Payload:
    kind: PayloadKind
    value: Any  # materialized data, file path, or JSON-compatible value
    meta: dict[str, Any] = field(default_factory=dict)


class DataBus:
    """In-memory store for node outputs, spilling DataFrames to Parquet."""

    def __init__(self, spill_dir: Path, pipeline_run_id: str | None = None) -> None:
        self._spill_dir = spill_dir
        self._run_id = pipeline_run_id if pipeline_run_id else uuid.uuid4().hex
        # Internal store keeps the *spilled* form: DataFrames as Path objects.
        # get() materializes back into a Payload whose value is the DataFrame.
        # Keys are (run_id, node_id, port) so multiple runs can share one bus.
        self._store: dict[tuple[str, str, str], Payload] = {}

    @property
    def pipeline_run_id(self) -> str:
        return self._run_id

    @property
    def spill_root(self) -> Path:
        """Subdirectory where this run's parquet spills live."""
        return self._spill_dir / self._run_id

    def put(self, node_id: str, port: str, value: Any) -> None:
        key = (self._run_id, node_id, port)
        if isinstance(value, pd.DataFrame):
            run_dir = self.spill_root
            run_dir.mkdir(parents=True, exist_ok=True)
            path = run_dir / f"{uuid.uuid4().hex}.parquet"
            value.to_parquet(path)
            self._store[key] = Payload(
                kind="dataframe",
                value=path,
                meta={"rows": len(value), "columns": list(value.columns)},
            )
            return

        if isinstance(value, _PRIMITIVE_TYPES):
            try:
                json.dumps(value)
            except (TypeError, ValueError) as exc:
                raise TypeError(
                    f"Value for {node_id!r}.{port!r} is not JSON-serializable"
                ) from exc
            self._store[key] = Payload(kind="json", value=value, meta={})
            return

        raise TypeError(
            f"Unsupported payload type for {node_id!r}.{port!r}: {type(value).__name__}"
        )

    def get(self, node_id: str, port: str) -> Payload:
        key = (self._run_id, node_id, port)
        if key not in self._store:
            raise KeyError(f"No payload stored for {node_id!r}.{port!r}")
        payload = self._store[key]
        if payload.kind == "dataframe" and isinstance(payload.value, Path):
            df = pd.read_parquet(payload.value)
            return Payload(kind="dataframe", value=df, meta=dict(payload.meta))
        return Payload(kind=payload.kind, value=payload.value, meta=dict(payload.meta))

    def clear_node(self, node_id: str) -> None:
        keys_to_drop = [k for k in self._store if k[0] == self._run_id and k[1] == node_id]
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
        """Drop every key + spilled file owned by this DataBus's run."""
        for key in [k for k in self._store if k[0] == self._run_id]:
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

    def keys(self) -> list[tuple[str, str]]:
        """All (node_id, port) keys stored for this run. Useful for tests."""
        return [(node_id, port) for run_id, node_id, port in self._store if run_id == self._run_id]
