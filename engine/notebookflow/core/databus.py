"""DataBus — typed payload routing between nodes.

Routing strategy by payload kind:
    * pandas DataFrames → spilled to Parquet, passed by file ref.
    * Primitives (int/float/str/bool/dict/list) → JSON in-memory.
    * Large blobs (>configurable threshold) → file ref to spill dir.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

PayloadKind = Literal["dataframe", "json", "fileref"]


@dataclass(slots=True)
class Payload:
    kind: PayloadKind
    value: Any  # actual data, file path, or JSON-able value
    meta: dict[str, Any]


class DataBus:
    def __init__(self, spill_dir: Path) -> None:
        self._spill_dir = spill_dir
        self._store: dict[tuple[str, str], Payload] = {}  # (node_id, port) -> payload

    def put(self, _node_id: str, _port: str, _value: Any) -> None:
        # TODO: classify value, spill if needed, store.
        raise NotImplementedError

    def get(self, _node_id: str, _port: str) -> Payload:
        # TODO: return payload, materializing from disk if it's a file ref.
        raise NotImplementedError

    def clear_node(self, _node_id: str) -> None:
        # TODO: drop all entries owned by node, delete spill files.
        raise NotImplementedError
