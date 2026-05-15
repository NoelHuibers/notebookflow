"""DataBus — typed payload routing between nodes.

Routing strategy by payload kind:
    * pandas DataFrames → spilled to Parquet, materialized on get().
    * Primitives (int/float/str/bool/None/dict/list) → JSON-compatible
      values kept in memory.
    * Anything else → ``TypeError`` for now. ``fileref`` kind is reserved
      for a future iteration (e.g. arbitrary large blobs the executor
      writes to disk directly).
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

    def __init__(self, spill_dir: Path) -> None:
        self._spill_dir = spill_dir
        # Internal store keeps the *spilled* form: DataFrames as Path objects.
        # get() materializes back into a Payload whose value is the DataFrame.
        self._store: dict[tuple[str, str], Payload] = {}

    def put(self, node_id: str, port: str, value: Any) -> None:
        key = (node_id, port)
        if isinstance(value, pd.DataFrame):
            self._spill_dir.mkdir(parents=True, exist_ok=True)
            path = self._spill_dir / f"{uuid.uuid4().hex}.parquet"
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
        key = (node_id, port)
        if key not in self._store:
            raise KeyError(f"No payload stored for {node_id!r}.{port!r}")
        payload = self._store[key]
        if payload.kind == "dataframe" and isinstance(payload.value, Path):
            df = pd.read_parquet(payload.value)
            return Payload(kind="dataframe", value=df, meta=dict(payload.meta))
        return Payload(kind=payload.kind, value=payload.value, meta=dict(payload.meta))

    def clear_node(self, node_id: str) -> None:
        keys_to_drop = [k for k in self._store if k[0] == node_id]
        for key in keys_to_drop:
            payload = self._store[key]
            if (
                payload.kind == "dataframe"
                and isinstance(payload.value, Path)
                and payload.value.exists()
            ):
                payload.value.unlink()
            del self._store[key]

    def keys(self) -> list[tuple[str, str]]:
        """Return all (node_id, port) keys currently stored. Useful for tests."""
        return list(self._store.keys())
