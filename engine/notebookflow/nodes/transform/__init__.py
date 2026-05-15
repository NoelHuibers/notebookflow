"""Transform nodes: stateless reshaping of data (Filter, GroupBy, Join, ...)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from notebookflow.protocol.manifest import NodeManifest, NodePort

if TYPE_CHECKING:
    from notebookflow.protocol.registry import Registry


FILTER_ROWS = NodeManifest(
    id="notebookflow.filter_rows",
    name="Filter Rows",
    tag="transform",
    version="0.1.0",
    description="Drop rows that don't satisfy a boolean condition.",
    inputs=[NodePort(name="df", type="dataframe")],
    outputs=[NodePort(name="df", type="dataframe")],
    template="df = df.dropna()\n",
)


def register_all(registry: Registry) -> None:
    registry.register(FILTER_ROWS)
