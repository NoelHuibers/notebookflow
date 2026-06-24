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

import contextlib
import time
import traceback
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from notebookflow.core.dag import DAG, DAGNode
from notebookflow.core.databus import DataBus

# nbformat-shaped output dicts. We don't validate against nbformat's JSON schema
# here -- consumers (web-app cell view, downloaded .ipynb) tolerate the same
# loose shape that real Jupyter kernels emit.
NbOutput = dict[str, Any]


@dataclass(slots=True)
class ExecutionResult:
    node_id: str
    status: str  # one of: ok, error, skipped
    error: str | None = None
    duration_ms: float = 0.0
    outputs: list[NbOutput] = field(default_factory=list)
    # Lightweight shape hints derived from the node's output-port values --
    # e.g. {"rows": 12438, "cols": 5} for a DataFrame. Powers the canvas
    # per-node meta line. Empty when no output is sized.
    metadata: dict[str, Any] = field(default_factory=dict)


class _StreamCapture:
    """File-like sink that appends nbformat stream outputs in arrival order.

    Adjacent writes to the same stream coalesce into one output entry so the
    list stays compact; writes interleaved with display() calls keep their
    relative order in the outputs list.
    """

    def __init__(self, outputs: list[NbOutput], name: str) -> None:
        self._outputs = outputs
        self._name = name

    def write(self, s: str) -> int:
        if not s:
            return 0
        last = self._outputs[-1] if self._outputs else None
        if (
            last is not None
            and last.get("output_type") == "stream"
            and last.get("name") == self._name
        ):
            last["text"] += s
        else:
            self._outputs.append({"output_type": "stream", "name": self._name, "text": s})
        return len(s)

    def flush(self) -> None:
        return


def _format_display(obj: Any) -> dict[str, str]:
    """Build an nbformat MIME bundle for one display() target."""
    data: dict[str, str] = {"text/plain": repr(obj)}
    html_repr = getattr(obj, "_repr_html_", None)
    if callable(html_repr):
        try:
            html = html_repr()
        except Exception:  # noqa: BLE001 -- a buggy _repr_html_ must not kill the cell
            html = None
        if isinstance(html, str):
            data["text/html"] = html
    return data


def _make_display(outputs: list[NbOutput]) -> Callable[..., None]:
    """Build a display() function that appends display_data outputs for this node."""

    def display(*objs: Any) -> None:
        for obj in objs:
            outputs.append(
                {
                    "output_type": "display_data",
                    "data": _format_display(obj),
                    "metadata": {},
                },
            )

    return display


def _introspect_outputs(namespace: dict[str, Any], ports: list[str]) -> dict[str, Any]:
    """Derive a shape hint from the node's first sized output-port value.

    Returns {"rows", "cols"} for a 2-D object (DataFrame / ndarray),
    {"rows"} for anything else with a length, or {} when nothing is sized.
    A buggy ``shape``/``__len__`` must not kill the result, so every probe
    is wrapped -- mirrors the BLE001 tolerance in ``_format_display``.
    """
    for port in ports:
        if port not in namespace:
            continue
        value = namespace[port]
        try:
            shape = getattr(value, "shape", None)
            if isinstance(shape, tuple) and len(shape) == 2:
                return {"rows": int(shape[0]), "cols": int(shape[1])}
        except Exception:  # noqa: BLE001 -- a buggy .shape must not kill the result
            pass
        if isinstance(value, (str, bytes, dict)):
            continue
        try:
            return {"rows": len(value)}
        except Exception:  # noqa: BLE001 -- a buggy __len__ must not kill the result
            continue
    return {}


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

    async def iter_pipeline(
        self,
        *,
        on_node_started: Callable[[DAGNode], Awaitable[None]] | None = None,
    ) -> AsyncIterator[ExecutionResult]:
        """Yield each node's ExecutionResult as soon as it finishes.

        On the first error, the remaining nodes are yielded as
        ``status="skipped"`` results so consumers see the full pipeline shape.
        Used by both ``run_pipeline`` (which accumulates into a list) and the
        WebSocket handler (which forwards each event as it lands).

        ``on_node_started`` is awaited right before ``run_node`` for each
        node, so the WebSocket handler can flush a ``nodeStarted`` event
        before exec() begins -- the canvas relies on that ordering to turn
        on the streaming cursor for the right cell.
        """
        order = self._dag.topological_order()
        name_to_id = {n.name: n.id for n in order}
        self._namespace = {}

        for node in order:
            inputs = self._gather_inputs(node, name_to_id)
            if on_node_started is not None:
                await on_node_started(node)
            result = await self.run_node(node, inputs)
            yield result
            if result.status == "error":
                for skipped in order[order.index(node) + 1 :]:
                    yield ExecutionResult(node_id=skipped.id, status="skipped")
                return

    async def run_node(self, node: DAGNode, inputs: dict[str, Any]) -> ExecutionResult:
        for port, value in inputs.items():
            self._namespace[port] = value

        outputs: list[NbOutput] = []
        stdout = _StreamCapture(outputs, "stdout")
        stderr = _StreamCapture(outputs, "stderr")
        # Inject display() into the cell's namespace so cell source can call it
        # without importing IPython. Fresh binding per node so each node's
        # display() targets its own outputs list.
        self._namespace["display"] = _make_display(outputs)

        start = time.monotonic()
        try:
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                if node.source:
                    exec(node.source, self._namespace)  # noqa: S102
        except Exception as exc:  # noqa: BLE001 — we deliberately surface every error
            duration_ms = (time.monotonic() - start) * 1000.0
            tb_lines = traceback.format_exception(type(exc), exc, exc.__traceback__)
            outputs.append(
                {
                    "output_type": "error",
                    "ename": type(exc).__name__,
                    "evalue": str(exc),
                    "traceback": [line.rstrip("\n") for line in tb_lines],
                },
            )
            return ExecutionResult(
                node_id=node.id,
                status="error",
                error=f"{type(exc).__name__}: {exc}",
                duration_ms=duration_ms,
                outputs=outputs,
            )
        duration_ms = (time.monotonic() - start) * 1000.0

        for port in node.outputs:
            if port in self._namespace:
                self._bus.put(node.id, port, self._namespace[port])

        return ExecutionResult(
            node_id=node.id,
            status="ok",
            duration_ms=duration_ms,
            outputs=outputs,
            metadata=_introspect_outputs(self._namespace, node.outputs),
        )

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
