"""Pipeline executor.

Walks a DAG in topological order, runs each node's source via ``exec()``
against a shared per-pipeline namespace, and mirrors each output port's
value into the DataBus for downstream inspection and persistence.

This synchronous evaluator is the Phase-3 starting point — it lets us run
a full pipeline end-to-end with no kernel and no platform adapter. The
async signatures are kept so the future kernel-backed implementation can
slot in without changing call sites.
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
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
        self._namespace: dict[str, Any] = {}

    async def run_pipeline(self) -> list[ExecutionResult]:
        results: list[ExecutionResult] = []
        async for result in self.iter_pipeline():
            results.append(result)
        return results

    async def iter_pipeline(self) -> AsyncIterator[ExecutionResult]:
        """Yield each node's ExecutionResult as soon as it finishes.

        On the first error, the remaining nodes are yielded as
        ``status="skipped"`` results so consumers see the full pipeline shape.
        Used by both ``run_pipeline`` (which accumulates into a list) and the
        WebSocket handler (which forwards each event as it lands).
        """
        order = self._dag.topological_order()
        name_to_id = {n.name: n.id for n in order}
        self._namespace = {}

        for node in order:
            inputs = self._gather_inputs(node, name_to_id)
            result = await self.run_node(node, inputs)
            yield result
            if result.status == "error":
                for skipped in order[order.index(node) + 1 :]:
                    yield ExecutionResult(node_id=skipped.id, status="skipped")
                return

    async def run_node(self, node: DAGNode, inputs: dict[str, Any]) -> ExecutionResult:
        for port, value in inputs.items():
            self._namespace[port] = value

        start = time.monotonic()
        try:
            if node.source:
                exec(node.source, self._namespace)  # noqa: S102
        except Exception as exc:  # noqa: BLE001 — we deliberately surface every error
            duration_ms = (time.monotonic() - start) * 1000.0
            return ExecutionResult(
                node_id=node.id,
                status="error",
                error=f"{type(exc).__name__}: {exc}",
                duration_ms=duration_ms,
            )
        duration_ms = (time.monotonic() - start) * 1000.0

        for port in node.outputs:
            if port in self._namespace:
                self._bus.put(node.id, port, self._namespace[port])

        return ExecutionResult(node_id=node.id, status="ok", duration_ms=duration_ms)

    def _gather_inputs(
        self, node: DAGNode, name_to_id: dict[str, str]
    ) -> dict[str, Any]:
        """Resolve marker ``in=`` refs to actual values via the DataBus."""
        result: dict[str, Any] = {}
        for ref in node.inputs:
            if "." not in ref:
                continue
            up_name, port = ref.rsplit(".", 1)
            up_id = name_to_id.get(up_name)
            if up_id is None:
                continue
            try:
                payload = self._bus.get(up_id, port)
            except KeyError:
                continue
            result[port] = payload.value
        return result

    @property
    def namespace(self) -> dict[str, Any]:
        """The shared per-pipeline namespace. Exposed for tests / inspection."""
        return self._namespace
