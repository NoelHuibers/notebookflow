"""Tests for the FastAPI surface."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from notebookflow.server import app


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


def test_list_nodes_returns_builtin_manifests(client: TestClient) -> None:
    r = client.get("/nodes")
    assert r.status_code == 200
    body = r.json()
    ids = {entry["id"] for entry in body}
    assert {
        "notebookflow.parse_csv",
        "notebookflow.filter_rows",
        "notebookflow.plot_chart",
    } <= ids


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

        completed_ids: list[str] = []
        while True:
            msg = ws.receive_json()
            if msg["type"] == "pipelineCompleted":
                final = msg
                break
            assert msg["type"] == "nodeCompleted"
            assert msg["pipelineId"] == "p1"
            completed_ids.append(msg["result"]["nodeId"])

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
            statuses.append(msg["result"]["status"])
        assert statuses == ["ok", "error", "skipped"]
