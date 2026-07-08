"""DAG construction and topological ordering.

Takes the platform-neutral graph model (nodes + wires, sourced from notebook
markers) and produces a directed acyclic graph the executor can walk.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Iterator
from dataclasses import dataclass, field


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
    source: str = ""  # cell source the synchronous executor runs
    # The node's notebook alias, used to resolve source refs inside input
    # bindings (``local<-alias:Node.port``). Empty string for single-notebook
    # pipelines.
    alias: str = ""


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
        if node.id in self._nodes:
            raise ValueError(f"DAG already contains node id {node.id!r}")
        self._nodes[node.id] = node

    def add_edge(self, edge: DAGEdge) -> None:
        if edge.source_node_id not in self._nodes:
            raise ValueError(f"Edge source node {edge.source_node_id!r} not in DAG")
        if edge.target_node_id not in self._nodes:
            raise ValueError(f"Edge target node {edge.target_node_id!r} not in DAG")
        self._edges.append(edge)

    def topological_order(self) -> list[DAGNode]:
        """Kahn's algorithm. Raises ValueError when a cycle is present."""
        in_degree: dict[str, int] = dict.fromkeys(self._nodes, 0)
        outgoing: dict[str, list[str]] = {nid: [] for nid in self._nodes}
        for edge in self._edges:
            in_degree[edge.target_node_id] += 1
            outgoing[edge.source_node_id].append(edge.target_node_id)

        ready: deque[str] = deque(nid for nid, d in in_degree.items() if d == 0)
        ordered: list[DAGNode] = []
        while ready:
            current = ready.popleft()
            ordered.append(self._nodes[current])
            for downstream in outgoing[current]:
                in_degree[downstream] -= 1
                if in_degree[downstream] == 0:
                    ready.append(downstream)

        if len(ordered) != len(self._nodes):
            raise ValueError("DAG contains a cycle")
        return ordered

    def upstream_of(self, node_id: str) -> Iterator[DAGNode]:
        """Yield every node transitively upstream of ``node_id`` (excluding it)."""
        if node_id not in self._nodes:
            raise KeyError(node_id)
        incoming: dict[str, list[str]] = {nid: [] for nid in self._nodes}
        for edge in self._edges:
            incoming[edge.target_node_id].append(edge.source_node_id)

        visited: set[str] = set()
        stack: list[str] = list(incoming[node_id])
        while stack:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)
            stack.extend(incoming[current])

        for upstream_id in visited:
            yield self._nodes[upstream_id]

    def nodes(self) -> list[DAGNode]:
        """Return all nodes (unordered). Useful for introspection / tests."""
        return list(self._nodes.values())

    def edges(self) -> list[DAGEdge]:
        """Return all edges (insertion order)."""
        return list(self._edges)
