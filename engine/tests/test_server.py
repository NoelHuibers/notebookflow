"""Tests for the FastAPI surface."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from notebookflow import server

app = server.app


@pytest.fixture
def client() -> Any:
    """TestClient as a context manager so the lifespan hook runs."""
    with TestClient(app) as test_client:
        yield test_client


def _linear_pipeline() -> dict[str, Any]:
    return {
        "nodes": [
            {
                "id": "a",
                "name": "A",
                "tag": "input",
                "inputs": [],
                "outputs": ["df"],
                "source": "df = [1, 2, 3, 4, 5]\n",
            },
            {
                "id": "b",
                "name": "B",
                "tag": "transform",
                "inputs": ["A.df"],
                "outputs": ["clean"],
                "source": "clean = [x for x in df if x % 2 == 1]\n",
            },
            {
                "id": "c",
                "name": "C",
                "tag": "output",
                "inputs": ["B.clean"],
                "outputs": ["total"],
                "source": "total = sum(clean)\n",
            },
        ],
        "edges": [
            {
                "sourceNodeId": "a",
                "sourcePort": "df",
                "targetNodeId": "b",
                "targetPort": "A.df",
            },
            {
                "sourceNodeId": "b",
                "sourcePort": "clean",
                "targetNodeId": "c",
                "targetPort": "B.clean",
            },
        ],
    }


def _cyclic_pipeline() -> dict[str, Any]:
    return {
        "nodes": [
            {"id": "a", "name": "A", "tag": "transform"},
            {"id": "b", "name": "B", "tag": "transform"},
        ],
        "edges": [
            {"sourceNodeId": "a", "sourcePort": "x", "targetNodeId": "b", "targetPort": "x"},
            {"sourceNodeId": "b", "sourcePort": "y", "targetNodeId": "a", "targetPort": "y"},
        ],
    }


def _failing_pipeline() -> dict[str, Any]:
    return {
        "nodes": [
            {"id": "a", "name": "A", "tag": "input", "outputs": ["x"], "source": "x = 1\n"},
            {
                "id": "b",
                "name": "B",
                "tag": "transform",
                "inputs": ["A.x"],
                "outputs": ["y"],
                "source": "raise RuntimeError('boom')\n",
            },
            {
                "id": "c",
                "name": "C",
                "tag": "output",
                "inputs": ["B.y"],
                "source": "print(y)\n",
            },
        ],
        "edges": [
            {"sourceNodeId": "a", "sourcePort": "x", "targetNodeId": "b", "targetPort": "A.x"},
            {"sourceNodeId": "b", "sourcePort": "y", "targetNodeId": "c", "targetPort": "B.y"},
        ],
    }


def test_health_returns_ok(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_load_engine_env_prefers_existing_env_and_local_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo_root = tmp_path / "repo"
    engine_root = repo_root / "engine"
    repo_root.mkdir()
    engine_root.mkdir()

    (repo_root / ".env.local").write_text(
        "NOTEBOOKFLOW_OPENAI_MODEL=local-model\n",
        encoding="utf-8",
    )
    (repo_root / ".env").write_text(
        "OPENAI_API_KEY=repo-file-key\nNOTEBOOKFLOW_OPENAI_MODEL=base-model\n",
        encoding="utf-8",
    )
    (engine_root / ".env").write_text(
        "OPENAI_API_KEY=engine-file-key\n",
        encoding="utf-8",
    )

    monkeypatch.setenv("OPENAI_API_KEY", "process-key")
    monkeypatch.delenv("NOTEBOOKFLOW_OPENAI_MODEL", raising=False)

    loaded = server.load_engine_env((repo_root, engine_root))

    assert loaded == [repo_root / ".env.local", repo_root / ".env", engine_root / ".env"]
    assert os.environ["OPENAI_API_KEY"] == "process-key"
    assert os.environ["NOTEBOOKFLOW_OPENAI_MODEL"] == "local-model"


def test_load_engine_env_uses_repo_root_env_before_engine_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo_root = tmp_path / "repo"
    engine_root = repo_root / "engine"
    repo_root.mkdir()
    engine_root.mkdir()

    (repo_root / ".env").write_text("OPENAI_API_KEY=repo-file-key\n", encoding="utf-8")
    (engine_root / ".env").write_text("OPENAI_API_KEY=engine-file-key\n", encoding="utf-8")

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    server.load_engine_env((repo_root, engine_root))

    assert os.environ["OPENAI_API_KEY"] == "repo-file-key"


def test_list_nodes_returns_builtin_manifests(client: TestClient) -> None:
    r = client.get("/nodes")
    assert r.status_code == 200
    body = r.json()
    ids = {entry["id"] for entry in body}
    assert {
        "notebookflow.ai_python_transform",
        "notebookflow.parse_csv",
        "notebookflow.filter_rows",
        "notebookflow.plot_chart",
    } <= ids

    parse_csv = next(entry for entry in body if entry["id"] == "notebookflow.parse_csv")
    assert parse_csv["configFields"][0]["key"] == "path"
    assert parse_csv["generationMode"] == "template"


def test_analyze_cells_returns_top_level_names(client: TestClient) -> None:
    r = client.post(
        "/cells/analyze",
        json={
            "cells": [
                {"source": "import pandas as pd\ndf = pd.read_csv('x.csv')\n"},
                {"source": "a, *rest = [1, 2, 3]\nfor i in rest:\n    nested = i\n"},
                {"source": "def helper():\n    pass\n"},
            ]
        },
    )
    assert r.status_code == 200
    cells = r.json()["cells"]
    assert cells[0]["definedNames"] == ["pd", "df"]
    # Unpacking targets are captured; the nested assignment is not top level.
    assert cells[1]["definedNames"] == ["a", "rest", "i"]
    assert cells[2]["definedNames"] == ["helper"]


def test_analyze_cells_reports_syntax_error_without_failing(client: TestClient) -> None:
    r = client.post("/cells/analyze", json={"cells": [{"source": "df = (\n"}]})
    assert r.status_code == 200
    cell = r.json()["cells"][0]
    assert cell["definedNames"] == []
    assert cell["syntaxError"] is not None


def test_synthesize_node_renders_template_manifest(client: TestClient) -> None:
    r = client.post(
        "/nodes/synthesize",
        json={
            "manifestId": "notebookflow.parse_csv",
            "nodeName": "Parse CSV",
            "inputs": [],
            "outputs": ["table"],
            "config": {"path": "sales.csv"},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["backend"] == "template"
    assert "table = pd.read_csv(\"sales.csv\")" in body["source"]
    assert body["warnings"] == []


def test_synthesize_node_falls_back_to_template_when_openai_missing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_OPENAI_API_KEY", raising=False)

    r = client.post(
        "/nodes/synthesize",
        json={
            "manifestId": "notebookflow.ai_python_transform",
            "nodeName": "AI Python Transform",
            "inputs": ["Load CSV.df"],
            "outputs": ["result"],
            "config": {"instruction": "Calculate the top 5 customers by revenue."},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["backend"] == "template"
    assert "OPENAI_API_KEY" in body["source"]
    assert body["warnings"] != []


def test_synthesize_node_falls_back_to_template_when_openai_request_fails(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    response = httpx.Response(status_code=401, request=request)

    async def failing_openai(*args: Any, **kwargs: Any) -> str:
        raise httpx.HTTPStatusError("401 Unauthorized", request=request, response=response)

    monkeypatch.setenv("OPENAI_API_KEY", "invalid-test-key")
    monkeypatch.delenv("NOTEBOOKFLOW_OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(server.CodeSynth, "_synthesize_with_openai", failing_openai)

    r = client.post(
        "/nodes/synthesize",
        json={
            "manifestId": "notebookflow.ai_python_transform",
            "nodeName": "AI Python Transform",
            "inputs": ["Load CSV.df"],
            "outputs": ["result"],
            "config": {"instruction": "Calculate the top 5 customers by revenue."},
        },
    )

    assert r.status_code == 200
    body = r.json()
    assert body["backend"] == "template"
    assert "result = None" in body["source"]
    assert any("OpenAI rejected the configured API key" in warning for warning in body["warnings"])


def test_run_pipeline_executes_in_topo_order(client: TestClient) -> None:
    r = client.post("/pipelines/demo/run", json=_linear_pipeline())
    assert r.status_code == 200
    body = r.json()
    assert body["pipelineId"] == "demo"
    statuses = [result["status"] for result in body["results"]]
    assert statuses == ["ok", "ok", "ok"]
    assert [result["nodeId"] for result in body["results"]] == ["a", "b", "c"]


def test_run_pipeline_with_cycle_returns_400(client: TestClient) -> None:
    r = client.post("/pipelines/demo/run", json=_cyclic_pipeline())
    assert r.status_code == 400
    assert "cycle" in r.json()["detail"].lower()


def test_run_pipeline_emits_skipped_for_downstream_of_error(client: TestClient) -> None:
    r = client.post("/pipelines/demo/run", json=_failing_pipeline())
    assert r.status_code == 200
    body = r.json()
    statuses = [result["status"] for result in body["results"]]
    assert statuses == ["ok", "error", "skipped"]


def test_ws_run_streams_execution_events(client: TestClient) -> None:
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "run", "pipelineId": "p1", "pipeline": _linear_pipeline()})

        started = ws.receive_json()
        assert started == {"type": "executionStarted", "pipelineId": "p1"}

        started_ids: list[str] = []
        completed_ids: list[str] = []
        while True:
            msg = ws.receive_json()
            if msg["type"] == "pipelineCompleted":
                final = msg
                break
            assert msg["pipelineId"] == "p1"
            if msg["type"] == "nodeStarted":
                started_ids.append(msg["nodeId"])
                continue
            assert msg["type"] == "nodeCompleted"
            completed_ids.append(msg["result"]["nodeId"])

        # Every node fires a nodeStarted event before its nodeCompleted.
        assert started_ids == ["a", "b", "c"]
        assert completed_ids == ["a", "b", "c"]
        assert [r["status"] for r in final["results"]] == ["ok", "ok", "ok"]


def test_ws_invalid_json_returns_error_and_keeps_connection_open(client: TestClient) -> None:
    with client.websocket_connect("/ws") as ws:
        ws.send_text("not json")
        msg = ws.receive_json()
        assert msg["type"] == "error"
        assert "invalid JSON" in msg["message"]

        # Connection still works after the error — send a real request.
        ws.send_json({"type": "run", "pipelineId": "p2", "pipeline": _linear_pipeline()})
        started = ws.receive_json()
        assert started["type"] == "executionStarted"


def test_ws_unknown_message_type_returns_error(client: TestClient) -> None:
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "frobnicate"})
        msg = ws.receive_json()
        assert msg["type"] == "error"
        assert "frobnicate" in msg["message"]


def test_ws_run_failure_streams_skipped_for_downstream(client: TestClient) -> None:
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "run", "pipelineId": "p3", "pipeline": _failing_pipeline()})
        _ = ws.receive_json()  # executionStarted

        statuses: list[str] = []
        while True:
            msg = ws.receive_json()
            if msg["type"] == "pipelineCompleted":
                break
            if msg["type"] == "nodeStarted":
                continue
            statuses.append(msg["result"]["status"])
        # Skipped nodes don't fire nodeStarted -- only the two that actually
        # made it to exec() should have raised one.
        assert statuses == ["ok", "error", "skipped"]


def test_ws_run_emits_node_started_before_each_node_completes(client: TestClient) -> None:
    """The streaming-cursor flow on the canvas depends on nodeStarted firing
    before the matching nodeCompleted; lock that ordering down."""
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "run", "pipelineId": "p4", "pipeline": _linear_pipeline()})
        _ = ws.receive_json()  # executionStarted

        in_flight: set[str] = set()
        while True:
            msg = ws.receive_json()
            if msg["type"] == "pipelineCompleted":
                break
            if msg["type"] == "nodeStarted":
                in_flight.add(msg["nodeId"])
            elif msg["type"] == "nodeCompleted":
                node_id = msg["result"]["nodeId"]
                assert node_id in in_flight, f"nodeCompleted for {node_id} without nodeStarted"
                in_flight.discard(node_id)
        assert in_flight == set()


# ---------------------------------------------------------------------------
# Bearer-token auth (NOTEBOOKFLOW_AUTH_TOKEN)
# ---------------------------------------------------------------------------


def test_health_remains_unauthenticated_when_token_set(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("NOTEBOOKFLOW_AUTH_TOKEN", "shh-secret")
    r = client.get("/health")
    assert r.status_code == 200


def test_list_nodes_rejects_request_without_bearer_when_token_set(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("NOTEBOOKFLOW_AUTH_TOKEN", "shh-secret")
    r = client.get("/nodes")
    assert r.status_code == 401
    assert "bearer" in r.json()["detail"].lower()


def test_list_nodes_rejects_request_with_wrong_token(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("NOTEBOOKFLOW_AUTH_TOKEN", "shh-secret")
    r = client.get("/nodes", headers={"Authorization": "Bearer not-the-right-one"})
    assert r.status_code == 401


def test_list_nodes_accepts_request_with_matching_token(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("NOTEBOOKFLOW_AUTH_TOKEN", "shh-secret")
    r = client.get("/nodes", headers={"Authorization": "Bearer shh-secret"})
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_run_pipeline_rejects_request_without_bearer_when_token_set(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("NOTEBOOKFLOW_AUTH_TOKEN", "shh-secret")
    r = client.post("/pipelines/demo/run", json=_linear_pipeline())
    assert r.status_code == 401


def test_run_pipeline_accepts_request_with_matching_token(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("NOTEBOOKFLOW_AUTH_TOKEN", "shh-secret")
    r = client.post(
        "/pipelines/demo/run",
        json=_linear_pipeline(),
        headers={"Authorization": "Bearer shh-secret"},
    )
    assert r.status_code == 200


def test_ws_rejects_handshake_without_token_query_param_when_token_set(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from starlette.websockets import WebSocketDisconnect as StarletteWSDisconnect

    monkeypatch.setenv("NOTEBOOKFLOW_AUTH_TOKEN", "shh-secret")
    with pytest.raises(StarletteWSDisconnect):
        with client.websocket_connect("/ws") as ws:
            ws.receive_json()


def test_ws_accepts_handshake_with_matching_token_query_param(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("NOTEBOOKFLOW_AUTH_TOKEN", "shh-secret")
    with client.websocket_connect("/ws?token=shh-secret") as ws:
        ws.send_json({"type": "run", "pipelineId": "auth", "pipeline": _linear_pipeline()})
        started = ws.receive_json()
        assert started["type"] == "executionStarted"


def test_empty_token_env_var_disables_auth(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("NOTEBOOKFLOW_AUTH_TOKEN", "")
    # No Authorization header -- should still succeed.
    r = client.get("/nodes")
    assert r.status_code == 200


# ---------------------------------------------------------------------------
# /pipelines/explain
# ---------------------------------------------------------------------------


def test_explain_pipeline_returns_template_prose_without_api_key(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)

    r = client.post("/pipelines/explain", json={"pipeline": _linear_pipeline()})
    assert r.status_code == 200
    body = r.json()
    assert body["backend"] == "template"
    assert body["prose"] != ""
    # Outline mentions every node name from the linear fixture.
    assert "A" in body["prose"]
    assert "B" in body["prose"]
    assert "C" in body["prose"]


def test_explain_pipeline_with_cycle_returns_400(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)

    r = client.post("/pipelines/explain", json={"pipeline": _cyclic_pipeline()})
    assert r.status_code == 400
    assert "cycle" in r.json()["detail"].lower()


def test_explain_pipeline_accepts_optional_instruction(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)

    r = client.post(
        "/pipelines/explain",
        json={"pipeline": _linear_pipeline(), "instruction": "Highlight the input source."},
    )
    assert r.status_code == 200
    # Template backend ignores instruction but the request shape still validates.
    assert r.json()["backend"] == "template"


# ---------------------------------------------------------------------------
# /pipelines/propose
# ---------------------------------------------------------------------------


def test_propose_pipeline_returns_template_draft_without_api_key(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)

    r = client.post(
        "/pipelines/propose",
        json={"prompt": "Load CSV, filter EU, plot revenue by region."},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["backend"] == "template"
    assert len(body["nodes"]) >= 3
    assert len(body["cellSources"]) == len(body["nodes"])
    assert all(src.startswith("# @node:") for src in body["cellSources"])


def test_propose_pipeline_empty_prompt_returns_400(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)

    r = client.post("/pipelines/propose", json={"prompt": "   "})
    assert r.status_code == 400
    assert "prompt" in r.json()["detail"].lower()


def test_propose_pipeline_accepts_notebook_path_override(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)

    r = client.post(
        "/pipelines/propose",
        json={"prompt": "Load CSV", "notebookPath": "my-pipeline.ipynb"},
    )
    assert r.status_code == 200
    assert r.json()["notebookPath"] == "my-pipeline.ipynb"


# ---------------------------------------------------------------------------
# Triggers (file_watch / cron / webhook / manual)
# ---------------------------------------------------------------------------


def test_trigger_lifecycle_register_list_fire_unregister(client: TestClient) -> None:
    # Register a manual trigger.
    r = client.post(
        "/triggers",
        json={
            "id": "manual-1",
            "kind": "manual",
            "pipelineId": "demo",
            "config": {},
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["id"] == "manual-1"
    assert body["kind"] == "manual"
    assert body["pipelineId"] == "demo"

    # List shows the new trigger.
    r = client.get("/triggers")
    assert r.status_code == 200
    listed = r.json()
    assert len(listed) == 1
    assert listed[0]["id"] == "manual-1"

    # Fire it -- response carries the firing record.
    r = client.post("/triggers/manual-1/fire", json={"payload": {"reason": "test"}})
    assert r.status_code == 200
    firing = r.json()
    assert firing["triggerId"] == "manual-1"
    assert firing["payload"] == {"reason": "test"}

    # Firings endpoint reflects the history.
    r = client.get("/triggers/manual-1/firings")
    assert r.status_code == 200
    assert [f["triggerId"] for f in r.json()] == ["manual-1"]

    # Unregister.
    r = client.delete("/triggers/manual-1")
    assert r.status_code == 204
    r = client.get("/triggers")
    assert r.json() == []


def test_trigger_duplicate_id_returns_400(client: TestClient) -> None:
    client.post(
        "/triggers",
        json={"id": "dup", "kind": "webhook", "pipelineId": "p", "config": {}},
    )
    r = client.post(
        "/triggers",
        json={"id": "dup", "kind": "webhook", "pipelineId": "p", "config": {}},
    )
    assert r.status_code == 400
    assert "already registered" in r.json()["detail"].lower()
    client.delete("/triggers/dup")  # cleanup


def test_fire_unknown_trigger_returns_404(client: TestClient) -> None:
    r = client.post("/triggers/no-such-thing/fire", json={"payload": {}})
    assert r.status_code == 404
    assert "unknown trigger" in r.json()["detail"].lower()


def test_unregister_unknown_trigger_returns_404(client: TestClient) -> None:
    r = client.delete("/triggers/never-registered")
    assert r.status_code == 404


def test_webhook_trigger_routes_payload_to_callback(client: TestClient) -> None:
    """End-to-end: register a webhook trigger and fire it via the POST route."""
    client.post(
        "/triggers",
        json={"id": "wh", "kind": "webhook", "pipelineId": "demo", "config": {}},
    )
    try:
        r = client.post(
            "/triggers/wh/fire",
            json={"payload": {"event": "push", "repo": "notebookflow"}},
        )
        assert r.status_code == 200
        assert r.json()["payload"]["repo"] == "notebookflow"
    finally:
        client.delete("/triggers/wh")


# ---------------------------------------------------------------------------
# /llm/ask -- command palette
# ---------------------------------------------------------------------------


def test_ask_endpoint_returns_template_answer_without_key(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)
    r = client.post("/llm/ask", json={"prompt": "How do I run this?"})
    assert r.status_code == 200
    body = r.json()
    assert body["backend"] == "template"
    assert "Run pipeline" in body["answer"]


def test_ask_endpoint_accepts_pipeline_context(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)
    r = client.post(
        "/llm/ask",
        json={"prompt": "explain this pipeline", "pipeline": _linear_pipeline()},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["backend"] == "template"
    # The explain-intent hint points at the Explain button regardless of context.
    assert "Explain" in body["answer"]


def test_ask_endpoint_empty_prompt_returns_400(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)
    r = client.post("/llm/ask", json={"prompt": "   "})
    assert r.status_code == 400
