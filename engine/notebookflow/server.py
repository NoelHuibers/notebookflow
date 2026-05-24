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

import json
import os
import tempfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
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


class ExecutionResultModel(_APIModel):
    node_id: str
    status: str
    error: str | None = None
    duration_ms: float


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
