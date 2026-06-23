"""Tests for the LLM Explainer (graph -> prose)."""

from __future__ import annotations

import httpx
import pytest

from notebookflow.core.dag import DAG, DAGEdge, DAGNode
from notebookflow.llm import explainer as explainer_module
from notebookflow.llm.explainer import Explainer


def _linear_dag() -> DAG:
    dag = DAG()
    dag.add_node(DAGNode(id="a", name="Load", tag="input", outputs=["df"]))
    dag.add_node(
        DAGNode(id="b", name="Clean", tag="transform", inputs=["Load.df"], outputs=["clean"]),
    )
    dag.add_node(DAGNode(id="c", name="Plot", tag="output", inputs=["Clean.clean"]))
    dag.add_edge(DAGEdge("a", "df", "b", "Load.df"))
    dag.add_edge(DAGEdge("b", "clean", "c", "Clean.clean"))
    return dag


async def test_template_backend_when_no_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)

    result = await Explainer().explain(_linear_dag())

    assert result.backend == "template"
    assert result.prose != ""
    # Outline mentions every node name.
    assert "Load" in result.prose
    assert "Clean" in result.prose
    assert "Plot" in result.prose
    # Outline mentions tags.
    assert "input" in result.prose
    assert "transform" in result.prose
    # End-to-end summary.
    assert "Load" in result.prose
    assert "Plot" in result.prose


async def test_template_backend_with_empty_dag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)

    result = await Explainer().explain(DAG())

    assert result.backend == "template"
    assert "empty" in result.prose.lower()


async def test_anthropic_backend_returns_concatenated_blocks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key")

    async def fake_post(
        _self: httpx.AsyncClient, *_args: object, **_kwargs: object
    ) -> httpx.Response:
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        return httpx.Response(
            status_code=200,
            request=request,
            json={
                "content": [
                    {"type": "text", "text": "First sentence. "},
                    {"type": "text", "text": "Second sentence."},
                ],
            },
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    result = await Explainer().explain(_linear_dag())
    assert result.backend == "anthropic"
    assert result.prose == "First sentence. Second sentence."


async def test_anthropic_failure_falls_back_to_template(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key")

    async def failing_post(
        _self: httpx.AsyncClient, *_args: object, **_kwargs: object
    ) -> httpx.Response:
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        response = httpx.Response(status_code=502, request=request)
        raise httpx.HTTPStatusError("Anthropic 502", request=request, response=response)

    monkeypatch.setattr(httpx.AsyncClient, "post", failing_post)

    result = await Explainer().explain(_linear_dag())
    assert result.backend == "template"
    assert result.warnings != []
    assert "fell back" in result.warnings[0].lower()


async def test_anthropic_empty_response_falls_back_to_template(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key")

    async def empty_post(
        _self: httpx.AsyncClient, *_args: object, **_kwargs: object
    ) -> httpx.Response:
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        return httpx.Response(status_code=200, request=request, json={"content": []})

    monkeypatch.setattr(httpx.AsyncClient, "post", empty_post)

    result = await Explainer().explain(_linear_dag())
    assert result.backend == "template"
    assert result.warnings != []
    assert "empty" in result.warnings[0].lower()


def test_build_prompt_includes_node_metadata_and_instruction() -> None:
    dag = _linear_dag()
    ordered = dag.topological_order()
    edges = dag.edges()
    prompt = explainer_module._build_prompt(ordered, edges, "Focus on data shape.")

    assert "Load" in prompt
    assert "transform" in prompt
    assert "Focus on data shape." in prompt
    # Edges encoded as from -> to.
    assert '"from"' in prompt
    assert '"to"' in prompt


def test_template_prose_handles_single_node_dag() -> None:
    dag = DAG()
    dag.add_node(DAGNode(id="solo", name="Standalone", tag="output"))
    prose = explainer_module._template_prose(dag.topological_order(), dag.edges())
    assert "Standalone" in prose
    assert "1 node" in prose
    # No "from X to Y" summary line when head == tail.
    assert "Data flows end-to-end" not in prose
