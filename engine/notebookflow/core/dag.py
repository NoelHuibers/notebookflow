"""DAG construction and topological ordering.

Takes the platform-neutral graph model (nodes + wires, sourced from notebook
markers) and produces a directed acyclic graph the executor can walk.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterator


@dataclass(slots=True)
class DAGNode:
    """A single executable node in the DAG."""

    id: str
    name: str
    tag: str  # one of: input, transform, output, ai, io
    inputs: list[str] = field(default_factory=list)
    outputs: list[str] = field(default_factory=list)
    notebook_path: str = ""
    cell_indices: list[int] = field(default_factory=list)


@dataclass(slots=True)
class DAGEdge:
    """A directed connection between two node ports."""

    source_node_id: str
    source_port: str
    target_node_id: str
    target_port: str


class DAG:
    """Directed acyclic graph of nodes."""

    def __init__(self) -> None:
        self._nodes: dict[str, DAGNode] = {}
        self._edges: list[DAGEdge] = []

    def add_node(self, node: DAGNode) -> None:
        # TODO: store node, reject duplicates.
        raise NotImplementedError

    def add_edge(self, edge: DAGEdge) -> None:
        # TODO: validate endpoints exist, append.
        raise NotImplementedError

    def topological_order(self) -> list[DAGNode]:
        # TODO: Kahn's algorithm; raise on cycle (notebooks are DAGs by spec).
        raise NotImplementedError

    def upstream_of(self, node_id: str) -> Iterator[DAGNode]:
        # TODO: yield all transitively-upstream nodes.
        raise NotImplementedError
