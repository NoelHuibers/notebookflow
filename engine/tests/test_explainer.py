"""Tests for the LLM Explainer (graph -> prose), BYOK via the gateway."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from notebookflow.core.dag import DAG, DAGEdge, DAGNode
from notebookflow.llm import explainer as explainer_module
from notebookflow.llm.client import LLMClient
from notebookflow.llm.credentials import CredentialContext
from notebookflow.llm.explainer import Explainer

_CREDS = CredentialContext(provider="anthropic", model="claude-sonnet-4-6", api_key="sk-test")


def _linear_dag() -> DAG:
    dag = DAG()
    dag.add_node(DAGNode(id="a", name="Load", tag="input", outputs=["df"]))
    dag.add_node(
        DAGNode(id="b", name="Clean", tag="transform", inputs=["df<-Load.df"], outputs=["clean"]),
    )
    dag.add_node(DAGNode(id="c", name="Plot", tag="output", inputs=["clean<-Clean.clean"]))
    dag.add_edge(DAGEdge("a", "df", "b", "df<-Load.df"))
    dag.add_edge(DAGEdge("b", "clean", "c", "clean<-Clean.clean"))
    return dag


def _explainer_returning(text: str) -> tuple[Explainer, list[dict[str, Any]]]:
    calls: list[dict[str, Any]] = []

    async def fake(**kwargs: Any) -> SimpleNamespace:
        calls.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])

    return Explainer(llm=LLMClient(acompletion=fake)), calls


# ---------------------------------------------------------------------------
# Template backend (no credentials)
# ---------------------------------------------------------------------------


async def test_template_backend_when_no_credentials() -> None:
    result = await Explainer().explain(_linear_dag())
    assert result.backend == "template"
    assert result.prose != ""
    for name in ("Load", "Clean", "Plot"):
        assert name in result.prose
    assert "input" in result.prose
    assert "transform" in result.prose


async def test_template_backend_with_empty_dag() -> None:
    result = await Explainer().explain(DAG())
    assert result.backend == "template"
    assert "empty" in result.prose.lower()


# ---------------------------------------------------------------------------
# Gateway backend (credentials present)
# ---------------------------------------------------------------------------


async def test_gateway_backend_returns_provider_prose() -> None:
    explainer, calls = _explainer_returning("First sentence. Second sentence.")
    result = await explainer.explain(_linear_dag(), credentials=_CREDS)
    assert result.backend == "anthropic"  # the concrete provider used
    assert result.prose == "First sentence. Second sentence."
    assert calls[0]["model"] == "anthropic/claude-sonnet-4-6"


async def test_gateway_failure_falls_back_to_template() -> None:
    async def boom(**_kwargs: Any) -> Any:
        raise RuntimeError("provider 502")

    explainer = Explainer(llm=LLMClient(acompletion=boom))
    result = await explainer.explain(_linear_dag(), credentials=_CREDS)
    assert result.backend == "template"
    assert result.warnings != []
    assert "fell back" in result.warnings[0].lower()


async def test_gateway_empty_response_falls_back_to_template() -> None:
    explainer, _ = _explainer_returning("")
    result = await explainer.explain(_linear_dag(), credentials=_CREDS)
    assert result.backend == "template"
    assert result.warnings != []
    assert "empty" in result.warnings[0].lower()


# ---------------------------------------------------------------------------
# Prompt + template helpers
# ---------------------------------------------------------------------------


def test_build_prompt_includes_node_metadata_and_instruction() -> None:
    dag = _linear_dag()
    prompt = explainer_module._build_prompt(
        dag.topological_order(), dag.edges(), "Focus on data shape."
    )
    assert "Load" in prompt
    assert "transform" in prompt
    assert "Focus on data shape." in prompt
    assert '"from"' in prompt
    assert '"to"' in prompt


def test_template_prose_handles_single_node_dag() -> None:
    dag = DAG()
    dag.add_node(DAGNode(id="solo", name="Standalone", tag="output"))
    prose = explainer_module._template_prose(dag.topological_order(), dag.edges())
    assert "Standalone" in prose
    assert "1 node" in prose
    assert "Data flows end-to-end" not in prose
