"""Tests for LLM NodeAuthor (natural-language → single node draft), BYOK."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from notebookflow.llm.client import LLMClient
from notebookflow.llm.credentials import CredentialContext
from notebookflow.llm.node_author import (
    NodeAuthor,
    NodeAuthorContext,
    NodeDraft,
    UpstreamOutputs,
)
from notebookflow.nodes import register as register_builtins
from notebookflow.protocol.registry import Registry

_CREDS = CredentialContext(provider="anthropic", model="claude-sonnet-4-6", api_key="sk-test")


def _registry() -> Registry:
    registry = Registry()
    register_builtins(registry)
    return registry


def _context() -> NodeAuthorContext:
    return NodeAuthorContext(
        upstream=[UpstreamOutputs(node_name="Load CSV", output_ports=["df"])],
        notebook_name="analysis.ipynb",
    )


def _author_returning(text: str) -> NodeAuthor:
    async def fake(**_kwargs: Any) -> SimpleNamespace:
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])

    return NodeAuthor(_registry(), llm=LLMClient(acompletion=fake))


def _author_raising() -> NodeAuthor:
    async def boom(**_kwargs: Any) -> Any:
        raise RuntimeError("provider 502")

    return NodeAuthor(_registry(), llm=LLMClient(acompletion=boom))


# ---------------------------------------------------------------------------
# Gateway backend (credentials present)
# ---------------------------------------------------------------------------


async def test_gateway_valid_json_resolves_binding_to_context_node() -> None:
    payload = (
        '{"name": "Filter High Revenue", "tag": "transform", '
        '"inputs": ["df<-Load CSV.df"], "outputs": ["filtered"], '
        '"body": "filtered = df[df[\\"revenue\\"] > 1000]\\n"}'
    )
    draft: NodeDraft = await _author_returning(payload).author(
        "keep rows over 1000", context=_context(), credentials=_CREDS
    )
    assert draft.backend == "anthropic"
    assert draft.name == "Filter High Revenue"
    assert draft.tag == "transform"
    assert draft.inputs == ["df<-Load CSV.df"]
    assert draft.outputs == ["filtered"]
    assert "revenue" in draft.body
    assert draft.warnings == []


async def test_gateway_strips_code_fences() -> None:
    fenced = (
        "```json\n"
        '{"name": "N", "tag": "transform", "inputs": [], '
        '"outputs": ["out"], "body": "out = 1\\n"}\n'
        "```"
    )
    draft = await _author_returning(fenced).author(
        "make one", context=_context(), credentials=_CREDS
    )
    assert draft.backend == "anthropic"
    assert draft.outputs == ["out"]


async def test_hallucinated_upstream_ref_is_dropped_and_warned() -> None:
    payload = (
        '{"name": "N", "tag": "transform", '
        '"inputs": ["x<-Ghost Node.data", "df<-Load CSV.df"], '
        '"outputs": ["out"], "body": "out = df\\n"}'
    )
    draft = await _author_returning(payload).author(
        "join", context=_context(), credentials=_CREDS
    )
    assert draft.inputs == ["df<-Load CSV.df"]
    assert any("Ghost Node.data" in w for w in draft.warnings)


async def test_invalid_tag_is_coerced_and_warned() -> None:
    payload = (
        '{"name": "N", "tag": "wizardry", "inputs": [], '
        '"outputs": ["out"], "body": "out = 1\\n"}'
    )
    draft = await _author_returning(payload).author(
        "do", context=_context(), credentials=_CREDS
    )
    assert draft.tag == "transform"
    assert any("wizardry" in w for w in draft.warnings)


async def test_invalid_output_identifier_is_dropped() -> None:
    payload = (
        '{"name": "N", "tag": "transform", "inputs": [], '
        '"outputs": ["good", "not a name", "2bad"], "body": "good = 1\\n"}'
    )
    draft = await _author_returning(payload).author(
        "do", context=_context(), credentials=_CREDS
    )
    assert draft.outputs == ["good"]
    assert sum("Dropped output" in w for w in draft.warnings) == 2


async def test_empty_body_falls_back_to_template() -> None:
    payload = '{"name": "N", "tag": "transform", "inputs": [], "outputs": ["out"], "body": "   "}'
    draft = await _author_returning(payload).author(
        "keep rows", context=_context(), credentials=_CREDS
    )
    assert draft.backend == "template"
    assert draft.body.strip() != ""
    assert any("empty body" in w.lower() for w in draft.warnings)


async def test_invalid_json_falls_back_to_template() -> None:
    draft = await _author_returning("definitely not json").author(
        "keep rows", context=_context(), credentials=_CREDS
    )
    assert draft.backend == "template"
    assert any("fell back" in w.lower() for w in draft.warnings)


async def test_gateway_failure_falls_back_to_template() -> None:
    draft = await _author_raising().author(
        "keep rows", context=_context(), credentials=_CREDS
    )
    assert draft.backend == "template"
    assert any("fell back" in w.lower() for w in draft.warnings)


# ---------------------------------------------------------------------------
# Template backend (no credentials)
# ---------------------------------------------------------------------------


async def test_no_credentials_returns_template_with_warning() -> None:
    draft = await NodeAuthor(_registry()).author(
        "summarise the revenue column", context=_context()
    )
    assert draft.backend == "template"
    assert draft.tag == "transform"
    # Best-effort binds the first upstream node's port.
    assert draft.inputs == ["df<-Load CSV.df"]
    assert "df" in draft.body
    assert any("No AI provider configured" in w for w in draft.warnings)


async def test_template_with_no_upstream_has_no_inputs() -> None:
    draft = await NodeAuthor(_registry()).author("load a csv", context=NodeAuthorContext())
    assert draft.backend == "template"
    assert draft.inputs == []
    assert draft.outputs == ["result"]
    assert "None" in draft.body
