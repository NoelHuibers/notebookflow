"""Tests for the FastAPI surface."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from notebookflow import server

app = server.app

_LLM_ENV_KEYS = (
    "NOTEBOOKFLOW_LLM_API_KEY",
    "NOTEBOOKFLOW_LLM_PROVIDER",
    "NOTEBOOKFLOW_LLM_MODEL",
    "NOTEBOOKFLOW_ANTHROPIC_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "NOTEBOOKFLOW_OPENAI_API_KEY",
)


@pytest.fixture(autouse=True)
def _clear_llm_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep credential resolution deterministic: no ambient provider key leaks
    into the no-credentials template-fallback tests."""
    for key in _LLM_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


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
                "inputs": ["df<-A.df"],
                "outputs": ["clean"],
                "source": "clean = [x for x in df if x % 2 == 1]\n",
            },
            {
                "id": "c",
                "name": "C",
                "tag": "output",
                "inputs": ["clean<-B.clean"],
                "outputs": ["total"],
                "source": "total = sum(clean)\n",
            },
        ],
        "edges": [
            {
                "sourceNodeId": "a",
                "sourcePort": "df",
                "targetNodeId": "b",
                "targetPort": "df<-A.df",
            },
            {
                "sourceNodeId": "b",
                "sourcePort": "clean",
                "targetNodeId": "c",
                "targetPort": "clean<-B.clean",
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
                "inputs": ["x<-A.x"],
                "outputs": ["y"],
                "source": "raise RuntimeError('boom')\n",
            },
            {
                "id": "c",
                "name": "C",
                "tag": "output",
                "inputs": ["y<-B.y"],
                "source": "print(y)\n",
            },
        ],
        "edges": [
            {"sourceNodeId": "a", "sourcePort": "x", "targetNodeId": "b", "targetPort": "x<-A.x"},
            {"sourceNodeId": "b", "sourcePort": "y", "targetNodeId": "c", "targetPort": "y<-B.y"},
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
    assert 'table = pd.read_csv("sales.csv")' in body["source"]
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


def test_synthesize_node_falls_back_to_template_when_provider_fails(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from notebookflow.llm.client import LLMError

    async def failing_gateway(*_args: Any, **_kwargs: Any) -> str:
        raise LLMError("anthropic request failed (HTTPStatusError)")

    monkeypatch.setattr(server.CodeSynth, "_synthesize_with_gateway", failing_gateway)

    # Per-request credentials so the endpoint takes the gateway path (not template).
    r = client.post(
        "/nodes/synthesize",
        json={
            "manifestId": "notebookflow.ai_python_transform",
            "nodeName": "AI Python Transform",
            "inputs": ["Load CSV.df"],
            "outputs": ["result"],
            "config": {"instruction": "Calculate the top 5 customers by revenue."},
            "credentials": {"provider": "anthropic", "model": "claude-x", "apiKey": "sk-test"},
        },
    )

    assert r.status_code == 200
    body = r.json()
    assert body["backend"] == "template"
    assert "result = None" in body["source"]
    assert any("fell back" in warning.lower() for warning in body["warnings"])


def test_upload_list_and_delete_data_file(client: TestClient) -> None:
    payload = b"region,revenue\nNorth,10\nSouth,20\n"
    r = client.post("/files", files={"file": ("orders.csv", payload, "text/csv")})
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "orders.csv"
    assert body["size"] == len(payload)

    listing = client.get("/files")
    assert listing.status_code == 200
    assert "orders.csv" in [entry["name"] for entry in listing.json()]

    deleted = client.delete("/files/orders.csv")
    assert deleted.status_code == 200
    after = client.get("/files")
    assert "orders.csv" not in [entry["name"] for entry in after.json()]


def test_upload_strips_path_traversal_from_filename(client: TestClient) -> None:
    r = client.post("/files", files={"file": ("../../etc/evil.csv", b"x\n", "text/csv")})
    assert r.status_code == 200
    # The path is reduced to its basename; nothing escapes the data dir.
    assert r.json()["name"] == "evil.csv"
    client.delete("/files/evil.csv")


def test_uploaded_file_is_readable_during_a_run(client: TestClient) -> None:
    client.post("/files", files={"file": ("nums.csv", b"value\n1\n2\n3\n", "text/csv")})
    pipeline = {
        "nodes": [
            {
                "id": "a",
                "name": "Load",
                "tag": "input",
                "inputs": [],
                "outputs": ["count"],
                "source": "import pandas as pd\ncount = len(pd.read_csv('nums.csv'))\n",
            },
        ],
        "edges": [],
    }
    r = client.post("/pipelines/files-demo/run", json=pipeline)
    assert r.status_code == 200
    assert r.json()["results"][0]["status"] == "ok"
    client.delete("/files/nums.csv")


def test_run_pipeline_executes_in_topo_order(client: TestClient) -> None:
    r = client.post("/pipelines/demo/run", json=_linear_pipeline())
    assert r.status_code == 200
    body = r.json()
    assert body["pipelineId"] == "demo"
    statuses = [result["status"] for result in body["results"]]
    assert statuses == ["ok", "ok", "ok"]
    assert [result["nodeId"] for result in body["results"]] == ["a", "b", "c"]


def test_run_pipeline_result_carries_metadata_shape(client: TestClient) -> None:
    # Node A outputs `df = [1, 2, 3, 4, 5]`, so metadata should report 5 rows.
    r = client.post("/pipelines/demo/run", json=_linear_pipeline())
    assert r.status_code == 200
    node_a = r.json()["results"][0]
    assert node_a["nodeId"] == "a"
    assert node_a["metadata"] == {"rows": 5}


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
# BetterAuth JWT auth (NOTEBOOKFLOW_JWKS_URL)
# ---------------------------------------------------------------------------


def _mint_jwt(
    monkeypatch: pytest.MonkeyPatch,
    *,
    sub: str = "user-123",
    exp_delta: int = 3600,
    verify_pub: Any = None,
) -> str:
    """Mint an EdDSA JWT (BetterAuth's default) and point the engine's JWKS
    lookup at the matching in-memory public key, so verification runs the real
    code path without a network round-trip.

    `verify_pub` overrides the public key the verifier sees — pass a foreign key
    to simulate a bad signature.
    """
    import time
    from types import SimpleNamespace

    import jwt as pyjwt
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from notebookflow import auth as auth_mod

    signing_key = Ed25519PrivateKey.generate()
    public_key = verify_pub if verify_pub is not None else signing_key.public_key()

    now = int(time.time())
    token = pyjwt.encode(
        {"sub": sub, "iat": now, "exp": now + exp_delta},
        signing_key,
        algorithm="EdDSA",
    )

    monkeypatch.setattr(
        auth_mod,
        "_get_jwks_client",
        lambda _url: SimpleNamespace(
            get_signing_key_from_jwt=lambda _t: SimpleNamespace(key=public_key)
        ),
    )
    monkeypatch.setenv("NOTEBOOKFLOW_JWKS_URL", "https://issuer.test/api/auth/jwks")
    return token


def test_authenticate_accepts_valid_jwt_and_extracts_sub(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from notebookflow import auth

    token = _mint_jwt(monkeypatch, sub="user-abc")
    principal = auth.authenticate(token)
    assert principal.user_id == "user-abc"


def test_authenticate_rejects_expired_jwt(monkeypatch: pytest.MonkeyPatch) -> None:
    from notebookflow import auth

    token = _mint_jwt(monkeypatch, exp_delta=-10)
    with pytest.raises(auth.AuthError):
        auth.authenticate(token)


def test_authenticate_rejects_jwt_with_wrong_signature(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from notebookflow import auth

    foreign_pub = Ed25519PrivateKey.generate().public_key()
    token = _mint_jwt(monkeypatch, verify_pub=foreign_pub)
    with pytest.raises(auth.AuthError):
        auth.authenticate(token)


def test_nodes_accepts_valid_jwt(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    token = _mint_jwt(monkeypatch)
    r = client.get("/nodes", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200


def test_nodes_rejects_invalid_jwt(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _mint_jwt(monkeypatch)  # configures JWKS; the presented token below is junk
    r = client.get("/nodes", headers={"Authorization": "Bearer not-a-real-jwt"})
    assert r.status_code == 401


def test_jwks_configured_rejects_missing_token(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("NOTEBOOKFLOW_JWKS_URL", "https://issuer.test/api/auth/jwks")
    r = client.get("/nodes")
    assert r.status_code == 401


def test_static_token_and_jwt_both_authenticate(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = _mint_jwt(monkeypatch)  # sets JWKS
    monkeypatch.setenv("NOTEBOOKFLOW_AUTH_TOKEN", "self-host-secret")
    assert (
        client.get("/nodes", headers={"Authorization": "Bearer self-host-secret"}).status_code
        == 200
    )
    assert client.get("/nodes", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_ws_accepts_valid_jwt_query_param(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = _mint_jwt(monkeypatch)
    with client.websocket_connect(f"/ws?token={token}") as ws:
        ws.send_json({"type": "run", "pipelineId": "auth", "pipeline": _linear_pipeline()})
        assert ws.receive_json()["type"] == "executionStarted"


# ---------------------------------------------------------------------------
# Per-tenant data files (#70)
# ---------------------------------------------------------------------------


def _jwt_factory(monkeypatch: pytest.MonkeyPatch):
    """Mint multiple JWTs (different `sub`s) all verifiable against one
    in-memory key, so several users can be authenticated within a single test."""
    import time
    from types import SimpleNamespace

    import jwt as pyjwt
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from notebookflow import auth as auth_mod

    signing_key = Ed25519PrivateKey.generate()
    public_key = signing_key.public_key()
    monkeypatch.setattr(
        auth_mod,
        "_get_jwks_client",
        lambda _url: SimpleNamespace(
            get_signing_key_from_jwt=lambda _t: SimpleNamespace(key=public_key)
        ),
    )
    monkeypatch.setenv("NOTEBOOKFLOW_JWKS_URL", "https://issuer.test/api/auth/jwks")

    def mint(sub: str) -> str:
        now = int(time.time())
        return pyjwt.encode(
            {"sub": sub, "iat": now, "exp": now + 3600}, signing_key, algorithm="EdDSA"
        )

    return mint


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_data_files_isolated_per_user(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    mint = _jwt_factory(monkeypatch)
    a = _bearer(mint("user-A"))
    b = _bearer(mint("user-B"))
    client.post("/files", files={"file": ("orders.csv", b"AAAA", "text/csv")}, headers=a)
    client.post("/files", files={"file": ("orders.csv", b"BB", "text/csv")}, headers=b)

    list_a = client.get("/files", headers=a).json()
    list_b = client.get("/files", headers=b).json()
    assert [f["name"] for f in list_a] == ["orders.csv"]
    assert [f["name"] for f in list_b] == ["orders.csv"]
    # Same name, different bytes -> separate stores, no collision.
    assert list_a[0]["size"] == 4
    assert list_b[0]["size"] == 2

    # Deleting A's file leaves B's intact.
    assert client.delete("/files/orders.csv", headers=a).status_code == 200
    assert client.get("/files", headers=a).json() == []
    assert len(client.get("/files", headers=b).json()) == 1
    client.delete("/files/orders.csv", headers=b)


def test_run_resolves_owning_users_data_file(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    mint = _jwt_factory(monkeypatch)
    owner = _bearer(mint("owner"))
    other = _bearer(mint("other"))
    client.post(
        "/files", files={"file": ("nums.csv", b"value\n1\n2\n3\n", "text/csv")}, headers=owner
    )
    pipeline = {
        "nodes": [
            {
                "id": "a",
                "name": "Load",
                "tag": "input",
                "inputs": [],
                "outputs": ["count"],
                "source": "import pandas as pd\ncount = len(pd.read_csv('nums.csv'))\n",
            }
        ],
        "edges": [],
    }
    owner_run = client.post("/pipelines/files/run", json=pipeline, headers=owner)
    assert owner_run.json()["results"][0]["status"] == "ok"
    # A different user's run can't see the owner's upload.
    other_run = client.post("/pipelines/files/run", json=pipeline, headers=other)
    assert other_run.json()["results"][0]["status"] == "error"
    client.delete("/files/nums.csv", headers=owner)


def test_data_file_quota_enforced(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    mint = _jwt_factory(monkeypatch)
    monkeypatch.setenv("NOTEBOOKFLOW_MAX_DATA_FILES", "1")
    h = _bearer(mint("limited"))
    assert (
        client.post("/files", files={"file": ("a.csv", b"x", "text/csv")}, headers=h).status_code
        == 200
    )
    over = client.post("/files", files={"file": ("b.csv", b"y", "text/csv")}, headers=h)
    assert over.status_code == 413
    # Overwriting an existing file doesn't count against the limit.
    assert (
        client.post("/files", files={"file": ("a.csv", b"xx", "text/csv")}, headers=h).status_code
        == 200
    )
    client.delete("/files/a.csv", headers=h)


def _post_request_with_content_length(value: str) -> Any:
    """Bare FastAPI Request carrying only a Content-Length header (#82)."""
    from fastapi import Request

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/files",
        "headers": [(b"content-length", value.encode())],
        "query_string": b"",
    }
    return Request(scope)


def test_upload_precheck_rejects_oversized_content_length(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from fastapi import HTTPException

    monkeypatch.setenv("NOTEBOOKFLOW_MAX_DATA_BYTES", "64")
    (tmp_path / "existing.csv").write_bytes(b"x" * 50)

    # 50 existing + 100 declared > 64 -> rejected before the body is read.
    with pytest.raises(HTTPException) as exc_info:
        server._precheck_upload_size(_post_request_with_content_length("100"), tmp_path, "new.csv")
    assert exc_info.value.status_code == 413

    # Fits the remaining quota -> allowed through to the authoritative check.
    server._precheck_upload_size(_post_request_with_content_length("10"), tmp_path, "new.csv")

    # Overwriting credits the existing file's size against the quota.
    server._precheck_upload_size(_post_request_with_content_length("60"), tmp_path, "existing.csv")

    # Absent or malformed Content-Length defers to the post-read enforcement.
    server._precheck_upload_size(_post_request_with_content_length("nope"), tmp_path, "new.csv")


def test_upload_content_length_precheck_413_before_body_read(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    mint = _jwt_factory(monkeypatch)
    monkeypatch.setenv("NOTEBOOKFLOW_MAX_DATA_BYTES", "64")
    # If the pre-check let the request through, this would blow up the test:
    # the 413 below must come from the Content-Length check, not post-read.
    monkeypatch.setattr(
        server,
        "_enforce_data_quota",
        lambda *a, **k: pytest.fail("body was read before the Content-Length pre-check fired"),
    )
    h = _bearer(mint("cl-precheck"))
    r = client.post("/files", files={"file": ("big.csv", b"x" * 4096, "text/csv")}, headers=h)
    assert r.status_code == 413


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
