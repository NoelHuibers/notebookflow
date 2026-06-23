"""Tests for the Ask LLM module backing the command palette."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from notebookflow.core.dag import DAG, DAGEdge, DAGNode
from notebookflow.llm.ask import Ask


def _dag() -> DAG:
    dag = DAG()
    dag.add_node(DAGNode(id="n1", name="Load CSV", tag="input", inputs=[], outputs=["df"]))
    dag.add_node(DAGNode(id="n2", name="Plot", tag="output", inputs=["df"], outputs=[]))
    dag.add_edge(
        DAGEdge(source_node_id="n1", source_port="df", target_node_id="n2", target_port="df"),
    )
    return dag


# ---------------------------------------------------------------------------
# Template fallback
# ---------------------------------------------------------------------------


async def test_template_fallback_with_no_key_returns_hint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)

    result = await Ask().ask("How do I run this pipeline?", dag=_dag())
    assert result.backend == "template"
    assert "Run pipeline" in result.answer
    # Pipeline summary is prepended when a dag is supplied.
    assert "nodes" in result.answer


async def test_template_explain_intent_points_at_explain_button(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)
    result = await Ask().ask("Explain what this pipeline does")
    assert result.backend == "template"
    assert "Explain" in result.answer


async def test_template_compose_intent_points_at_compose_button(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)
    result = await Ask().ask("Compose a pipeline that loads CSV")
    assert result.backend == "template"
    assert "Compose" in result.answer


async def test_template_unknown_intent_returns_generic_hint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)
    result = await Ask().ask("What is the meaning of life?")
    assert result.backend == "template"
    assert "ANTHROPIC_API_KEY" in result.answer


async def test_empty_prompt_returns_short_intro(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)
    result = await Ask().ask("   ")
    assert result.backend == "template"
    assert "Ask me" in result.answer


# ---------------------------------------------------------------------------
# Anthropic backend
# ---------------------------------------------------------------------------


async def test_anthropic_backend_returns_text(monkeypatch: pytest.MonkeyPatch) -> None:
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
                    {"type": "text", "text": "Your pipeline loads CSV and plots it."},
                ],
            },
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    result = await Ask().ask("describe my pipeline", dag=_dag())
    assert result.backend == "anthropic"
    assert result.answer == "Your pipeline loads CSV and plots it."


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
    result = await Ask().ask("explain the pipeline")
    assert result.backend == "template"
    assert result.warnings != []


async def test_anthropic_empty_response_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key")

    async def empty_post(
        _self: httpx.AsyncClient, *_args: object, **_kwargs: object
    ) -> httpx.Response:
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        return httpx.Response(status_code=200, request=request, json={"content": []})

    monkeypatch.setattr(httpx.AsyncClient, "post", empty_post)
    result = await Ask().ask("explain the pipeline")
    assert result.backend == "template"
    assert any("empty" in w.lower() for w in result.warnings)


async def test_anthropic_request_includes_pipeline_when_supplied(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key")
    seen_bodies: list[Any] = []

    async def fake_post(
        _self: httpx.AsyncClient, _url: str, **kwargs: Any
    ) -> httpx.Response:
        seen_bodies.append(kwargs["json"])
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        return httpx.Response(
            status_code=200,
            request=request,
            json={"content": [{"type": "text", "text": "ok"}]},
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    await Ask().ask("what does Load CSV do?", dag=_dag())
    assert len(seen_bodies) == 1
    user_message = seen_bodies[0]["messages"][0]["content"]
    assert "Current pipeline" in user_message
    assert "Load CSV" in user_message
