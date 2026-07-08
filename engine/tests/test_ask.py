"""Tests for the Ask LLM module (BYOK via the LLMClient gateway)."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from notebookflow.core.dag import DAG, DAGEdge, DAGNode
from notebookflow.llm.ask import Ask
from notebookflow.llm.client import LLMClient
from notebookflow.llm.credentials import CredentialContext

_CREDS = CredentialContext(provider="openai", model="gpt-4o", api_key="sk-test")


def _dag() -> DAG:
    dag = DAG()
    dag.add_node(DAGNode(id="n1", name="Load CSV", tag="input", inputs=[], outputs=["df"]))
    dag.add_node(
        DAGNode(id="n2", name="Plot", tag="output", inputs=["df<-Load CSV.df"], outputs=[])
    )
    dag.add_edge(
        DAGEdge(
            source_node_id="n1",
            source_port="df",
            target_node_id="n2",
            target_port="df<-Load CSV.df",
        ),
    )
    return dag


def _ask_returning(text: str) -> tuple[Ask, list[dict[str, Any]]]:
    """An Ask whose gateway returns `text` and records the calls it received."""
    calls: list[dict[str, Any]] = []

    async def fake(**kwargs: Any) -> SimpleNamespace:
        calls.append(kwargs)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=text))],
        )

    return Ask(llm=LLMClient(acompletion=fake)), calls


def _ask_raising() -> Ask:
    async def boom(**_kwargs: Any) -> Any:
        raise RuntimeError("provider down")

    return Ask(llm=LLMClient(acompletion=boom))


# ---------------------------------------------------------------------------
# Template fallback (no credentials)
# ---------------------------------------------------------------------------


async def test_no_credentials_returns_template_hint() -> None:
    ask, _ = _ask_returning("unused")
    result = await ask.ask("How do I run this pipeline?", dag=_dag(), credentials=None)
    assert result.backend == "template"
    assert "Run pipeline" in result.answer


async def test_explain_intent_points_at_explain_button() -> None:
    ask, _ = _ask_returning("unused")
    result = await ask.ask("Explain what this pipeline does", credentials=None)
    assert result.backend == "template"
    assert "Explain" in result.answer


async def test_unknown_intent_mentions_byok() -> None:
    ask, _ = _ask_returning("unused")
    result = await ask.ask("What is the meaning of life?", credentials=None)
    assert result.backend == "template"
    assert "Settings" in result.answer


async def test_empty_prompt_returns_short_intro() -> None:
    ask, _ = _ask_returning("unused")
    result = await ask.ask("   ", credentials=_CREDS)
    assert result.backend == "template"
    assert "Ask me" in result.answer


# ---------------------------------------------------------------------------
# Gateway-backed (credentials present)
# ---------------------------------------------------------------------------


async def test_credentials_route_through_gateway() -> None:
    ask, calls = _ask_returning("Your pipeline loads CSV and plots it.")
    result = await ask.ask("describe my pipeline", dag=_dag(), credentials=_CREDS)
    assert result.backend == "openai"  # the concrete provider used
    assert result.answer == "Your pipeline loads CSV and plots it."
    assert calls[0]["model"] == "openai/gpt-4o"


async def test_pipeline_context_woven_into_message() -> None:
    ask, calls = _ask_returning("ok")
    await ask.ask("what does Load CSV do?", dag=_dag(), credentials=_CREDS)
    # The gateway prepends the system message, so the user message is last.
    user_message = calls[0]["messages"][-1]["content"]
    assert "Current pipeline" in user_message
    assert "Load CSV" in user_message


async def test_gateway_failure_falls_back_to_template() -> None:
    ask = _ask_raising()
    result = await ask.ask("explain the pipeline", dag=_dag(), credentials=_CREDS)
    assert result.backend == "template"
    assert result.warnings != []


async def test_empty_completion_falls_back_to_template() -> None:
    ask, _ = _ask_returning("")
    result = await ask.ask("explain the pipeline", credentials=_CREDS)
    assert result.backend == "template"
    assert any("empty" in w.lower() for w in result.warnings)
