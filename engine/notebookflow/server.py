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
import secrets
import tempfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, Literal

from dotenv import load_dotenv
from fastapi import (
    Depends,
    FastAPI,
    File,
    HTTPException,
    Request,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from notebookflow.core.dag import DAG, DAGEdge, DAGNode
from notebookflow.core.databus import DataBus
from notebookflow.core.executor import ExecutionResult, Executor
from notebookflow.core.triggers import Trigger, TriggerFiring, TriggerManager
from notebookflow.llm.ask import Ask
from notebookflow.llm.code_synth import CodeSynth
from notebookflow.llm.credentials import CredentialContext, resolve_credentials
from notebookflow.llm.explainer import Explainer
from notebookflow.llm.pipeline_author import PipelineAuthor
from notebookflow.protocol.registry import Registry


def _default_env_roots() -> tuple[Path, Path]:
    package_dir = Path(__file__).resolve().parent
    engine_root = package_dir.parent
    repo_root = engine_root.parent
    return repo_root, engine_root


def load_engine_env(search_roots: tuple[Path, ...] | None = None) -> list[Path]:
    """Load local `.env` files for engine startup.

    Precedence is:
    1. already-exported process env vars
    2. `.env.local`
    3. `.env`

    Files are searched in the provided roots order, defaulting to repo root
    first and `engine/` second.
    """

    loaded: list[Path] = []
    roots = search_roots if search_roots is not None else _default_env_roots()
    for root in roots:
        for filename in (".env.local", ".env"):
            path = root / filename
            if not path.is_file():
                continue
            load_dotenv(path, override=False)
            loaded.append(path)
    return loaded


_LOADED_ENV_FILES = load_engine_env()


def _expected_token() -> str:
    """Look up the shared secret each request. Reading per-request lets tests
    monkeypatch the env var without restarting the app."""
    return os.environ.get("NOTEBOOKFLOW_AUTH_TOKEN", "")


def require_auth(request: Request) -> None:
    """FastAPI dependency: require a matching `Authorization: Bearer ...` header.

    No-op when the token env var is unset or empty, so local development and
    self-hosted single-user deploys don't need any config. When the variable
    is set, every protected route rejects missing or mismatched tokens with
    401. Tokens compared via secrets.compare_digest to dodge timing attacks.
    """
    expected = _expected_token()
    if expected == "":
        return
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    presented = header.removeprefix("Bearer ").strip()
    if not secrets.compare_digest(presented, expected):
        raise HTTPException(status_code=401, detail="invalid bearer token")


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
    # Notebook alias for resolving cross-notebook input refs. Empty for
    # single-notebook pipelines.
    alias: str = ""


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
    # Shape hints for the canvas meta line, e.g. {"rows": 12438, "cols": 5}.
    # Single-word field so camelCase is a no-op; inner keys pass through.
    metadata: dict[str, Any] = Field(default_factory=dict)


class RunResponse(_APIModel):
    pipeline_id: str
    results: list[ExecutionResultModel]


class CredentialsModel(_APIModel):
    """Per-request bring-your-own-key context from the web-app's Settings.
    Never persisted, never logged."""

    provider: str = ""
    model: str = ""
    api_key: str = ""


class SynthesizeNodeRequest(_APIModel):
    manifest_id: str
    node_name: str
    inputs: list[str] = Field(default_factory=list)
    outputs: list[str] = Field(default_factory=list)
    config: dict[str, str] = Field(default_factory=dict)
    current_source: str = ""
    credentials: CredentialsModel | None = None


class SynthesizeNodeResponse(_APIModel):
    source: str
    backend: str
    warnings: list[str] = Field(default_factory=list)


class ExplainPipelineRequest(_APIModel):
    pipeline: PipelineDef
    instruction: str = ""
    credentials: CredentialsModel | None = None


class ExplainPipelineResponse(_APIModel):
    prose: str
    backend: str
    warnings: list[str] = Field(default_factory=list)


class ProposePipelineRequest(_APIModel):
    prompt: str
    notebook_path: str = "generated.ipynb"
    credentials: CredentialsModel | None = None


class ProposePipelineNode(_APIModel):
    manifest_id: str
    name: str
    config: dict[str, str] = Field(default_factory=dict)


class ProposePipelineEdge(_APIModel):
    src: str = Field(..., alias="from")
    dst: str = Field(..., alias="to")


class ProposePipelineResponse(_APIModel):
    notebook_path: str
    cell_sources: list[str]
    nodes: list[ProposePipelineNode] = Field(default_factory=list)
    edges: list[dict[str, str]] = Field(default_factory=list)
    backend: str
    warnings: list[str] = Field(default_factory=list)


class TriggerSpec(_APIModel):
    id: str
    kind: Literal["manual", "file_watch", "cron", "webhook"]
    pipeline_id: str
    config: dict[str, Any] = Field(default_factory=dict)


class TriggerFiringModel(_APIModel):
    trigger_id: str
    fired_at: float
    payload: dict[str, Any] = Field(default_factory=dict)


class FireTriggerRequest(_APIModel):
    payload: dict[str, Any] = Field(default_factory=dict)


class AskRequest(_APIModel):
    prompt: str
    pipeline: PipelineDef | None = None
    credentials: CredentialsModel | None = None


class AskResponse(_APIModel):
    answer: str
    backend: str
    warnings: list[str] = Field(default_factory=list)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Discover available node manifests on startup; clean up triggers on exit."""
    registry = Registry.discover()
    _app.state.registry = registry
    _app.state.code_synth = CodeSynth(registry)
    _app.state.explainer = Explainer()
    _app.state.pipeline_author = PipelineAuthor(registry)
    _app.state.ask = Ask()
    trigger_manager = TriggerManager()
    trigger_manager.on_fire(_log_trigger_fire)
    _app.state.trigger_manager = trigger_manager
    try:
        yield
    finally:
        await trigger_manager.shutdown()


async def _log_trigger_fire(trigger: Trigger, firing: TriggerFiring) -> None:
    """Default on_fire callback -- just logs. Hosts that want to actually
    run a pipeline on a trigger fire should replace this via
    ``trigger_manager.on_fire(...)`` after the app starts up."""
    import logging  # noqa: PLC0415

    logging.getLogger(__name__).info(
        "Trigger %r fired at %s for pipeline %r",
        trigger.id,
        firing.fired_at,
        trigger.pipeline_id,
    )


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


def _code_synth(app_ref: FastAPI) -> CodeSynth:
    synth = getattr(app_ref.state, "code_synth", None)
    if not isinstance(synth, CodeSynth):
        registry = _registry(app_ref)
        synth = CodeSynth(registry)
        app_ref.state.code_synth = synth
    return synth


def _explainer(app_ref: FastAPI) -> Explainer:
    explainer = getattr(app_ref.state, "explainer", None)
    if not isinstance(explainer, Explainer):
        explainer = Explainer()
        app_ref.state.explainer = explainer
    return explainer


def _pipeline_author(app_ref: FastAPI) -> PipelineAuthor:
    author = getattr(app_ref.state, "pipeline_author", None)
    if not isinstance(author, PipelineAuthor):
        author = PipelineAuthor(_registry(app_ref))
        app_ref.state.pipeline_author = author
    return author


def _trigger_manager(app_ref: FastAPI) -> TriggerManager:
    manager = getattr(app_ref.state, "trigger_manager", None)
    if not isinstance(manager, TriggerManager):
        manager = TriggerManager()
        manager.on_fire(_log_trigger_fire)
        app_ref.state.trigger_manager = manager
    return manager


def _ask(app_ref: FastAPI) -> Ask:
    ask = getattr(app_ref.state, "ask", None)
    if not isinstance(ask, Ask):
        ask = Ask()
        app_ref.state.ask = ask
    return ask


def _resolve_creds(credentials: CredentialsModel | None) -> CredentialContext | None:
    """Per-request key wins; else a self-host env key; else None (template)."""
    if credentials is None:
        return resolve_credentials()
    return resolve_credentials(credentials.provider, credentials.model, credentials.api_key)


def _data_dir(app_ref: FastAPI) -> Path:
    """The directory holding uploaded data files (e.g. CSVs).

    One directory per engine process today (a single-tenant local store); the
    hosted product swaps this for a per-tenant location. Configurable via
    NOTEBOOKFLOW_DATA_DIR, else a temp dir created once.
    """
    existing = getattr(app_ref.state, "data_dir", None)
    if isinstance(existing, Path):
        return existing
    configured = os.environ.get("NOTEBOOKFLOW_DATA_DIR", "").strip()
    path = Path(configured) if configured != "" else Path(tempfile.mkdtemp(prefix="nbf-data-"))
    path.mkdir(parents=True, exist_ok=True)
    app_ref.state.data_dir = path
    return path


def _safe_data_name(name: str) -> str:
    """Reject path traversal -- uploads are flat files keyed by basename."""
    base = os.path.basename(name.strip())
    if base in ("", ".", "..") or "/" in base or "\\" in base:
        raise HTTPException(status_code=400, detail="invalid file name")
    return base


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
                alias=node.alias,
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
        metadata=result.metadata,
    )


async def _run_pipeline(pipeline_id: str, pipeline: PipelineDef) -> list[ExecutionResult]:
    try:
        dag = _build_dag(pipeline)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    with tempfile.TemporaryDirectory(prefix="nbf-spill-") as spill_dir:
        bus = DataBus(spill_dir=Path(spill_dir), pipeline_run_id=pipeline_id)
        executor = Executor(dag=dag, bus=bus, data_dir=_data_dir(app))
        try:
            return await executor.run_pipeline()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/nodes", dependencies=[Depends(require_auth)])
async def list_nodes() -> list[dict[str, object]]:
    return [m.model_dump(mode="json", by_alias=True) for m in _registry(app).all()]


@app.post(
    "/nodes/synthesize",
    response_model=SynthesizeNodeResponse,
    dependencies=[Depends(require_auth)],
)
async def synthesize_node(request: SynthesizeNodeRequest) -> SynthesizeNodeResponse:
    registry = _registry(app)
    try:
        manifest = registry.get(request.manifest_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail=f"unknown manifest id: {request.manifest_id}",
        ) from exc

    result = await _code_synth(app).synthesize(
        manifest,
        node_name=request.node_name,
        inputs=request.inputs,
        outputs=request.outputs,
        config=request.config,
        current_source=request.current_source,
        credentials=_resolve_creds(request.credentials),
    )
    return SynthesizeNodeResponse(
        source=result.source,
        backend=result.backend,
        warnings=result.warnings,
    )


@app.post(
    "/cells/analyze",
    response_model=AnalyzeResponse,
    dependencies=[Depends(require_auth)],
)
async def analyze_cells(request: AnalyzeRequest) -> AnalyzeResponse:
    """Static analysis used by the canvas to autocomplete port variable names.

    Returns, per cell, the names bound at module top level. Cells with syntax
    errors yield an empty list plus the error message rather than failing the
    whole request, so the canvas keeps working while the user is mid-edit.
    """
    return AnalyzeResponse(cells=[_analyze_cell(cell.source) for cell in request.cells])


class DataFileModel(_APIModel):
    name: str
    size: int


@app.get("/files", response_model=list[DataFileModel], dependencies=[Depends(require_auth)])
async def list_data_files() -> list[DataFileModel]:
    """Uploaded data files (CSVs etc.) a pipeline can read by name."""
    data_dir = _data_dir(app)
    return [
        DataFileModel(name=entry.name, size=entry.stat().st_size)
        for entry in sorted(data_dir.iterdir())
        if entry.is_file()
    ]


@app.post("/files", response_model=DataFileModel, dependencies=[Depends(require_auth)])
async def upload_data_file(file: Annotated[UploadFile, File()]) -> DataFileModel:
    """Store an uploaded data file so cells can `read_csv("name")` it on run."""
    name = _safe_data_name(file.filename or "")
    contents = await file.read()
    target = _data_dir(app) / name
    target.write_bytes(contents)
    return DataFileModel(name=name, size=len(contents))


@app.delete("/files/{name}", dependencies=[Depends(require_auth)])
async def delete_data_file(name: str) -> dict[str, str]:
    target = _data_dir(app) / _safe_data_name(name)
    if target.is_file():
        target.unlink()
    return {"status": "ok"}


@app.post(
    "/pipelines/{pipeline_id}/run",
    response_model=RunResponse,
    dependencies=[Depends(require_auth)],
)
async def run_pipeline(pipeline_id: str, pipeline: PipelineDef) -> RunResponse:
    results = await _run_pipeline(pipeline_id, pipeline)
    return RunResponse(
        pipeline_id=pipeline_id, results=[_result_to_model(r) for r in results]
    )


@app.post(
    "/pipelines/explain",
    response_model=ExplainPipelineResponse,
    dependencies=[Depends(require_auth)],
)
async def explain_pipeline(request: ExplainPipelineRequest) -> ExplainPipelineResponse:
    """Return a literate prose walkthrough of the pipeline.

    Runs through the LLMClient gateway with the per-request provider/key
    (bring-your-own-key) or a self-host env key; falls back to a deterministic
    template outline otherwise so the canvas sidebar always has something.
    """
    try:
        dag = _build_dag(request.pipeline)
        result = await _explainer(app).explain(
            dag,
            instruction=request.instruction,
            credentials=_resolve_creds(request.credentials),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ExplainPipelineResponse(
        prose=result.prose,
        backend=result.backend,
        warnings=result.warnings,
    )


@app.post(
    "/pipelines/propose",
    response_model=ProposePipelineResponse,
    dependencies=[Depends(require_auth)],
)
async def propose_pipeline(request: ProposePipelineRequest) -> ProposePipelineResponse:
    """Draft a new pipeline from a natural-language prompt.

    Runs through the LLMClient gateway with the per-request provider/key
    (bring-your-own-key) or a self-host env key; falls back to a keyword-driven
    template draft otherwise, so the canvas always gets something usable. The
    response is everything the web-app needs to swap the current notebook
    contents with the draft (cell_sources) or render a preview (nodes + edges).
    """
    if request.prompt.strip() == "":
        raise HTTPException(
            status_code=400,
            detail="Empty prompt -- describe the pipeline you want.",
        )
    draft = await _pipeline_author(app).propose(
        request.prompt,
        notebook_path=request.notebook_path,
        credentials=_resolve_creds(request.credentials),
    )
    return ProposePipelineResponse(
        notebook_path=draft.notebook_path,
        cell_sources=draft.cell_sources,
        nodes=[ProposePipelineNode(**node) for node in draft.nodes],
        edges=draft.edges,
        backend=draft.backend,
        warnings=draft.warnings,
    )


# ---------------------------------------------------------------------------
# Triggers (file_watch / cron / webhook / manual)
# ---------------------------------------------------------------------------


def _spec_to_trigger(spec: TriggerSpec) -> Trigger:
    return Trigger(
        id=spec.id,
        kind=spec.kind,
        pipeline_id=spec.pipeline_id,
        config=dict(spec.config),
    )


def _trigger_to_spec(trigger: Trigger) -> TriggerSpec:
    return TriggerSpec(
        id=trigger.id,
        kind=trigger.kind,
        pipeline_id=trigger.pipeline_id,
        config=dict(trigger.config),
    )


def _firing_to_model(firing: TriggerFiring) -> TriggerFiringModel:
    return TriggerFiringModel(
        trigger_id=firing.trigger_id,
        fired_at=firing.fired_at,
        payload=dict(firing.payload),
    )


@app.get("/triggers", dependencies=[Depends(require_auth)])
async def list_triggers() -> list[dict[str, Any]]:
    return [
        _trigger_to_spec(t).model_dump(by_alias=True) for t in _trigger_manager(app).list_triggers()
    ]


@app.post(
    "/triggers",
    response_model=TriggerSpec,
    status_code=201,
    dependencies=[Depends(require_auth)],
)
async def register_trigger(spec: TriggerSpec) -> TriggerSpec:
    try:
        _trigger_manager(app).register(_spec_to_trigger(spec))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return spec


@app.delete(
    "/triggers/{trigger_id}",
    status_code=204,
    dependencies=[Depends(require_auth)],
)
async def unregister_trigger(trigger_id: str) -> Response:
    try:
        await _trigger_manager(app).unregister(trigger_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"unknown trigger id: {trigger_id}") from exc
    return Response(status_code=204)


@app.post(
    "/triggers/{trigger_id}/fire",
    response_model=TriggerFiringModel,
    dependencies=[Depends(require_auth)],
)
async def fire_trigger(trigger_id: str, request: FireTriggerRequest) -> TriggerFiringModel:
    """Fire a trigger -- the webhook ingress and manual-run path both flow
    through here. Works for any registered kind."""
    try:
        firing = await _trigger_manager(app).fire(trigger_id, payload=dict(request.payload))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"unknown trigger id: {trigger_id}") from exc
    return _firing_to_model(firing)


@app.get("/triggers/{trigger_id}/firings", dependencies=[Depends(require_auth)])
async def list_firings(trigger_id: str) -> list[dict[str, Any]]:
    manager = _trigger_manager(app)
    try:
        manager.get(trigger_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"unknown trigger id: {trigger_id}") from exc
    return [_firing_to_model(f).model_dump(by_alias=True) for f in manager.firings(trigger_id)]


# ---------------------------------------------------------------------------
# /llm/ask -- command palette free-form Q&A
# ---------------------------------------------------------------------------


@app.post(
    "/llm/ask",
    response_model=AskResponse,
    dependencies=[Depends(require_auth)],
)
async def ask_llm(request: AskRequest) -> AskResponse:
    """Free-form Q&A backing the web-app's Cmd/Ctrl+K command palette.

    Runs through the LLMClient gateway using the per-request provider/key
    (bring-your-own-key), or a self-host env key, and otherwise falls back to
    a keyword-driven template hint.
    """
    if request.prompt.strip() == "":
        raise HTTPException(status_code=400, detail="prompt must not be empty")
    dag: DAG | None = None
    if request.pipeline is not None:
        try:
            dag = _build_dag(request.pipeline)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    result = await _ask(app).ask(
        request.prompt,
        dag=dag,
        credentials=_resolve_creds(request.credentials),
    )
    return AskResponse(answer=result.answer, backend=result.backend, warnings=result.warnings)


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

    Auth: when NOTEBOOKFLOW_AUTH_TOKEN is set, the client must present the
    same token as a ``?token=...`` query parameter (browsers can't attach
    Authorization headers to WebSocket connections, so a URL parameter is
    the lowest-friction option). The handshake is rejected with code 1008
    (Policy Violation) when the token is missing or mismatched.
    """
    expected = _expected_token()
    if expected != "":
        presented = websocket.query_params.get("token", "")
        if not secrets.compare_digest(presented, expected):
            await websocket.close(code=1008, reason="unauthorized")
            return
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
        bus = DataBus(spill_dir=Path(spill_dir), pipeline_run_id=pipeline_id)
        executor = Executor(dag=dag, bus=bus, data_dir=_data_dir(app))

        async def on_node_started(node: DAGNode) -> None:
            # iter_pipeline awaits this before running each node, so the
            # canvas's streaming cursor flips on for the correct cell before
            # exec() begins.
            await websocket.send_json(
                {
                    "type": "nodeStarted",
                    "pipelineId": pipeline_id,
                    "nodeId": node.id,
                },
            )

        try:
            async for result in executor.iter_pipeline(on_node_started=on_node_started):
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
