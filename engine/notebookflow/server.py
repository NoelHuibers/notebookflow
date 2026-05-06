"""FastAPI + WebSocket entry point.

This is the *only* engine surface the platform adapters talk to. JupyterLab
proxies to it via jupyter-server-proxy; VS Code spawns it as a child process
and connects directly; the standalone web app connects to a remotely hosted
instance.

Surface:
    GET  /health                      — liveness probe.
    GET  /nodes                       — list registered manifests.
    POST /pipelines/{id}/run          — kick off an execution.
    WS   /ws                          — bidirectional sync events + execution
                                        progress streamed to the canvas.
"""

from __future__ import annotations

from fastapi import FastAPI, WebSocket

from notebookflow.protocol.registry import Registry

app = FastAPI(title="NotebookFlow Engine", version="0.0.0")
_registry: Registry | None = None


@app.on_event("startup")
async def _startup() -> None:
    # TODO: registry = Registry.discover(); store in module global / app.state.
    raise NotImplementedError


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/nodes")
async def list_nodes() -> list[dict[str, object]]:
    # TODO: return [m.model_dump() for m in _registry.all()]
    raise NotImplementedError


@app.post("/pipelines/{pipeline_id}/run")
async def run_pipeline(_pipeline_id: str) -> dict[str, object]:
    # TODO: load pipeline, build DAG, dispatch to Executor.
    raise NotImplementedError


@app.websocket("/ws")
async def ws(_websocket: WebSocket) -> None:
    # TODO: accept, then multiplex sync events + execution progress.
    raise NotImplementedError


def main() -> None:
    """CLI entry point — `notebookflow` script declared in pyproject.toml."""
    import uvicorn

    uvicorn.run("notebookflow.server:app", host="127.0.0.1", port=8765, reload=False)
