"""Pipeline executor.

Walks a DAG in topological order, runs each node's cells through a kernel
(or a pure-Python evaluator for headless/web-app mode), and routes outputs
through the DataBus to downstream nodes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from notebookflow.core.dag import DAG, DAGNode
from notebookflow.core.databus import DataBus


@dataclass(slots=True)
class ExecutionResult:
    node_id: str
    status: str  # one of: ok, error, skipped
    error: str | None = None
    duration_ms: float = 0.0


class Executor:
    def __init__(self, dag: DAG, bus: DataBus) -> None:
        self._dag = dag
        self._bus = bus

    async def run_pipeline(self) -> list[ExecutionResult]:
        # TODO: topo-sort, run each node, halt-on-error policy from config.
        raise NotImplementedError

    async def run_node(self, _node: DAGNode, _inputs: dict[str, Any]) -> ExecutionResult:
        # TODO: dispatch by tag; for code nodes, exec cell source against
        #   a long-lived kernel session; capture outputs into the bus.
        raise NotImplementedError
