"""FastAPI + WebSocket entry point.

This is the *only* engine surface the platform adapters talk to. JupyterLab
proxies to it via jupyter-server-proxy; VS Code spawns it as a child process
and connects directly; the standalone web app connects to a remotely hosted
instance.

Surface:
    GET  /health                      — liveness probe.
    GET  /nodes                       — list registered manifests.
    POST /pipelines/{id}/run          — kick off an execution.
    WS   /ws                          — receive run requests + stream
                                        execution progress to the canvas.
"""

from __future__ import annotations

import ast
import json
import os
import tempfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from notebookflow.core.dag import DAG, DAGEdge, DAGNode
from notebookflow.core.databus import DataBus
from notebookflow.core.executor import ExecutionResult, Executor
from notebookflow.protocol.registry import Registry


class _APIModel(BaseModel):
    """Pydantic base that serialises snake_case fields as camelCase on the wire."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class NodeDef(_APIModel):
    id: str
    name: str
    tag: str
    inputs: list[str] = []
    outputs: list[str] = []
    source: str = ""
    notebook_path: str = ""
    cell_indices: list[int] = []


class EdgeDef(_APIModel):
    source_node_id: str
    source_port: str
    target_node_id: str
    target_port: str


class PipelineDef(_APIModel):
    nodes: list[NodeDef]
    edges: list[EdgeDef]


class CellSource(_APIModel):
    source: str = ""


class AnalyzeRequest(_APIModel):
    cells: list[CellSource] = Field(default_factory=list)


class CellAnalysis(_APIModel):
    # Names bound at module top level by the cell, in source order. Empty when
    # the cell has a syntax error so partial edits never break the canvas.
    defined_names: list[str] = Field(default_factory=list)
    syntax_error: str | None = None


class AnalyzeResponse(_APIModel):
    cells: list[CellAnalysis] = Field(default_factory=list)


class ExecutionResultModel(_APIModel):
    node_id: str
    status: str
    error: str | None = None
    duration_ms: float
    # nbformat-shaped outputs (stream/display_data/error). Snake_case keys
    # inside each dict stay as-is -- to_camel only renames pydantic fields,
    # not arbitrary dict contents, so nbformat round-trips cleanly.
    outputs: list[dict[str, Any]] = Field(default_factory=list)


class RunResponse(_APIModel):
    pipeline_id: str
    results: list[ExecutionResultModel]


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Discover available node manifests on startup."""
    _app.state.registry = Registry.discover()
    yield


app = FastAPI(title="NotebookFlow Engine", version="0.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _registry(app_ref: FastAPI) -> Registry:
    registry = getattr(app_ref.state, "registry", None)
    if not isinstance(registry, Registry):
        # Tests that drive endpoints without TestClient context-management
        # (i.e. without lifespan) get a lazily-populated registry here so the
        # endpoint contract still holds.
        registry = Registry.discover()
        app_ref.state.registry = registry
    return registry


def _collect_target_names(target: ast.expr, into: list[str], seen: set[str]) -> None:
    """Collect names bound by an assignment / loop / with target.

    Handles plain names plus tuple / list unpacking and starred targets so
    ``a, (b, *c) = ...`` contributes ``a``, ``b`` and ``c``.
    """
    if isinstance(target, ast.Name):
        if target.id not in seen:
            seen.add(target.id)
            into.append(target.id)
    elif isinstance(target, ast.Starred):
        _collect_target_names(target.value, into, seen)
    elif isinstance(target, (ast.Tuple, ast.List)):
        for element in target.elts:
            _collect_target_names(element, into, seen)


def _defined_names(source: str) -> list[str]:
    """Return the names a cell binds at module top level, in source order.

    Mirrors how the executor injects cell outputs: only top-level bindings are
    visible to downstream nodes, so nested assignments are intentionally
    ignored. Walrus expressions are collected wherever they appear since they
    leak into the enclosing scope.
    """
    module = ast.parse(source)
    names: list[str] = []
    seen: set[str] = set()

    def add(name: str) -> None:
        if name not in seen:
            seen.add(name)
            names.append(name)

    for stmt in module.body:
        if isinstance(stmt, ast.Assign):
            for target in stmt.targets:
                _collect_target_names(target, names, seen)
        elif isinstance(stmt, (ast.AnnAssign, ast.AugAssign)):
            _collect_target_names(stmt.target, names, seen)
        elif isinstance(stmt, (ast.For, ast.AsyncFor)):
            _collect_target_names(stmt.target, names, seen)
        elif isinstance(stmt, (ast.With, ast.AsyncWith)):
            for item in stmt.items:
                if item.optional_vars is not None:
                    _collect_target_names(item.optional_vars, names, seen)
        elif isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            add(stmt.name)
        elif isinstance(stmt, (ast.Import, ast.ImportFrom)):
            for alias in stmt.names:
                bound = alias.asname or alias.name.split(".", 1)[0]
                add(bound)

    # Walrus bindings can hide anywhere in the cell's expressions.
    for node in ast.walk(module):
        if isinstance(node, ast.NamedExpr) and isinstance(node.target, ast.Name):
            add(node.target.id)

    return names


def _analyze_cell(source: str) -> CellAnalysis:
    """Parse one cell, returning its top-level names or the syntax error."""
    try:
        return CellAnalysis(defined_names=_defined_names(source))
    except SyntaxError as exc:
        return CellAnalysis(defined_names=[], syntax_error=str(exc))


def _build_dag(pipeline: PipelineDef) -> DAG:
    dag = DAG()
    for node in pipeline.nodes:
        dag.add_node(
            DAGNode(
                id=node.id,
                name=node.name,
                tag=node.tag,
                inputs=list(node.inputs),
                outputs=list(node.outputs),
                notebook_path=node.notebook_path,
                cell_indices=list(node.cell_indices),
                source=node.source,
            )
        )
    for edge in pipeline.edges:
        dag.add_edge(
            DAGEdge(
                source_node_id=edge.source_node_id,
                source_port=edge.source_port,
                target_node_id=edge.target_node_id,
                target_port=edge.target_port,
            )
        )
    return dag


def _result_to_model(result: ExecutionResult) -> ExecutionResultModel:
    return ExecutionResultModel(
        node_id=result.node_id,
        status=result.status,
        error=result.error,
        duration_ms=result.duration_ms,
        outputs=result.outputs,
    )


async def _run_pipeline(pipeline: PipelineDef) -> list[ExecutionResult]:
    try:
        dag = _build_dag(pipeline)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    with tempfile.TemporaryDirectory(prefix="nbf-spill-") as spill_dir:
        bus = DataBus(spill_dir=Path(spill_dir))
        executor = Executor(dag=dag, bus=bus)
        try:
            return await executor.run_pipeline()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/nodes")
async def list_nodes() -> list[dict[str, object]]:
    return [m.model_dump(mode="json") for m in _registry(app).all()]


@app.post("/cells/analyze", response_model=AnalyzeResponse)
async def analyze_cells(request: AnalyzeRequest) -> AnalyzeResponse:
    """Static analysis used by the canvas to autocomplete port variable names.

    Returns, per cell, the names bound at module top level. Cells with syntax
    errors yield an empty list plus the error message rather than failing the
    whole request, so the canvas keeps working while the user is mid-edit.
    """
    return AnalyzeResponse(cells=[_analyze_cell(cell.source) for cell in request.cells])


@app.post("/pipelines/{pipeline_id}/run", response_model=RunResponse)
async def run_pipeline(pipeline_id: str, pipeline: PipelineDef) -> RunResponse:
    results = await _run_pipeline(pipeline)
    return RunResponse(
        pipeline_id=pipeline_id, results=[_result_to_model(r) for r in results]
    )


@app.websocket("/ws")
async def ws(websocket: WebSocket) -> None:
    """Bidirectional channel.

    Currently supports a single message type:

      Client → server: {"type": "run", "pipelineId": str, "pipeline": PipelineDef}
      Server → client: {"type": "executionStarted", "pipelineId": str}
                       {"type": "nodeCompleted", "pipelineId": str, "result": ExecutionResultModel}
                       {"type": "pipelineCompleted", "pipelineId": str, "results": [...]}

    Bad input echoes back as ``{"type": "error", "message": "..."}`` and the
    connection stays open so the client can recover.
    """
    await websocket.accept()
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError as exc:
                await websocket.send_json({"type": "error", "message": f"invalid JSON: {exc}"})
                continue

            msg_type = msg.get("type")
            if msg_type != "run":
                await websocket.send_json(
                    {"type": "error", "message": f"unknown message type: {msg_type!r}"}
                )
                continue

            pipeline_id = msg.get("pipelineId")
            pipeline_payload = msg.get("pipeline")
            if not isinstance(pipeline_id, str) or pipeline_payload is None:
                await websocket.send_json(
                    {"type": "error", "message": "missing pipelineId or pipeline"}
                )
                continue

            try:
                pipeline = PipelineDef.model_validate(pipeline_payload)
            except (ValueError, TypeError) as exc:
                await websocket.send_json({"type": "error", "message": str(exc)})
                continue

            await _stream_run(websocket, pipeline_id, pipeline)
    except WebSocketDisconnect:
        return


async def _stream_run(
    websocket: WebSocket, pipeline_id: str, pipeline: PipelineDef
) -> None:
    await websocket.send_json({"type": "executionStarted", "pipelineId": pipeline_id})

    try:
        dag = _build_dag(pipeline)
    except ValueError as exc:
        await websocket.send_json(
            {"type": "error", "pipelineId": pipeline_id, "message": str(exc)}
        )
        return

    results: list[ExecutionResult] = []
    with tempfile.TemporaryDirectory(prefix="nbf-spill-") as spill_dir:
        bus = DataBus(spill_dir=Path(spill_dir))
        executor = Executor(dag=dag, bus=bus)
        try:
            async for result in executor.iter_pipeline():
                results.append(result)
                await websocket.send_json(
                    {
                        "type": "nodeCompleted",
                        "pipelineId": pipeline_id,
                        "result": _result_to_model(result).model_dump(by_alias=True),
                    }
                )
        except ValueError as exc:
            await websocket.send_json(
                {"type": "error", "pipelineId": pipeline_id, "message": str(exc)}
            )
            return

    await websocket.send_json(
        {
            "type": "pipelineCompleted",
            "pipelineId": pipeline_id,
            "results": [_result_to_model(r).model_dump(by_alias=True) for r in results],
        }
    )


def main() -> None:
    """CLI entry point — `notebookflow` script declared in pyproject.toml.

    Reads the ``PORT`` env var (Fly.io / Railway / Render all set this); falls
    back to 8765 for local development. Always binds ``0.0.0.0`` in container
    contexts; local dev gets the same since loopback connections still work.
    """
    import uvicorn

    port = int(os.environ.get("PORT", "8765"))
    host = os.environ.get("HOST", "0.0.0.0")
    uvicorn.run("notebookflow.server:app", host=host, port=port, reload=False)
