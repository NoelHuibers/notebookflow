"""Tests for LLM PipelineAuthor (natural-language → pipeline draft), BYOK."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from notebookflow.llm import pipeline_author as pa_module
from notebookflow.llm.client import LLMClient
from notebookflow.llm.credentials import CredentialContext
from notebookflow.llm.pipeline_author import PipelineAuthor, PipelineDraft
from notebookflow.nodes import register as register_builtins
from notebookflow.protocol.registry import Registry

_CREDS = CredentialContext(provider="anthropic", model="claude-sonnet-4-6", api_key="sk-test")


def _registry() -> Registry:
    registry = Registry()
    register_builtins(registry)
    return registry


def _author_returning(text: str, *, registry: Registry | None = None) -> PipelineAuthor:
    """A PipelineAuthor whose gateway returns `text` as the completion."""

    async def fake(**_kwargs: Any) -> SimpleNamespace:
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])

    return PipelineAuthor(registry or _registry(), llm=LLMClient(acompletion=fake))


def _author_raising() -> PipelineAuthor:
    async def boom(**_kwargs: Any) -> Any:
        raise RuntimeError("provider 502")

    return PipelineAuthor(_registry(), llm=LLMClient(acompletion=boom))


# ---------------------------------------------------------------------------
# Template backend (no credentials)
# ---------------------------------------------------------------------------


async def test_template_backend_picks_csv_filter_plot() -> None:
    author = PipelineAuthor(_registry())
    draft: PipelineDraft = await author.propose(
        "Load CSV, filter EU rows, plot revenue by region",
    )

    assert draft.backend == "template"
    assert len(draft.nodes) >= 3
    manifest_ids = [node["manifest_id"] for node in draft.nodes]
    assert "notebookflow.parse_csv" in manifest_ids
    assert "notebookflow.filter_rows" in manifest_ids
    assert "notebookflow.plot_chart" in manifest_ids
    assert all(src.startswith("# @node:") for src in draft.cell_sources)
    assert any("read_csv" in src for src in draft.cell_sources)
    assert len(draft.edges) == len(draft.nodes) - 1


async def test_template_backend_returns_demo_when_no_keywords_match() -> None:
    author = PipelineAuthor(_registry())
    draft = await author.propose("zzz nothing matches here")
    assert draft.backend == "template"
    assert [node["manifest_id"] for node in draft.nodes] == [
        "notebookflow.parse_csv",
        "notebookflow.filter_rows",
        "notebookflow.plot_chart",
    ]


async def test_template_draft_with_empty_registry() -> None:
    author = PipelineAuthor(Registry())
    draft = await author.propose("Load CSV and plot.", credentials=_CREDS)
    assert draft.nodes == []
    assert draft.cell_sources == []
    assert "no manifests" in draft.warnings[0].lower()


# ---------------------------------------------------------------------------
# Gateway backend (credentials present)
# ---------------------------------------------------------------------------


async def test_gateway_backend_materialises_valid_response() -> None:
    payload_text = (
        '{"nodes": ['
        ' {"manifest_id": "notebookflow.parse_csv", "name": "Load CSV", '
        '  "config": {"path": "sales.csv"}},'
        ' {"manifest_id": "notebookflow.filter_rows", "name": "Filter EU", '
        '  "config": {"condition": "region == \\"EU\\""}},'
        ' {"manifest_id": "notebookflow.plot_chart", "name": "Plot", '
        '  "config": {"kind": "bar"}}],'
        ' "edges": ['
        '  {"from": "Load CSV.df", "to": "Filter EU.df"},'
        '  {"from": "Filter EU.df", "to": "Plot.df"}]}'
    )
    draft = await _author_returning(payload_text).propose("anything", credentials=_CREDS)
    assert draft.backend == "anthropic"  # the concrete provider used
    assert [node["name"] for node in draft.nodes] == ["Load CSV", "Filter EU", "Plot"]
    assert draft.nodes[0]["config"]["path"] == "sales.csv"
    assert all("# @node:" in src for src in draft.cell_sources)


async def test_gateway_response_strips_code_fences() -> None:
    fenced = (
        "```json\n"
        '{"nodes": ['
        ' {"manifest_id": "notebookflow.parse_csv", "name": "Load", "config": {}}],'
        ' "edges": []}\n'
        "```"
    )
    draft = await _author_returning(fenced).propose("load csv", credentials=_CREDS)
    assert draft.backend == "anthropic"
    assert len(draft.nodes) == 1


async def test_gateway_unknown_manifest_ids_are_dropped() -> None:
    payload_text = (
        '{"nodes": ['
        ' {"manifest_id": "notebookflow.parse_csv", "name": "Load", "config": {}},'
        ' {"manifest_id": "notebookflow.bogus_node", "name": "Bogus", "config": {}}],'
        ' "edges": []}'
    )
    draft = await _author_returning(payload_text).propose("ignore", credentials=_CREDS)
    assert [node["manifest_id"] for node in draft.nodes] == ["notebookflow.parse_csv"]


async def test_gateway_failure_falls_back_to_template() -> None:
    draft = await _author_raising().propose("plot revenue by region", credentials=_CREDS)
    assert draft.backend == "template"
    assert draft.warnings != []
    assert "fell back" in draft.warnings[0].lower()


async def test_gateway_empty_response_falls_back() -> None:
    draft = await _author_returning("").propose("plot revenue by region", credentials=_CREDS)
    assert draft.backend == "template"
    assert any("empty" in w.lower() for w in draft.warnings)


async def test_gateway_invalid_json_falls_back() -> None:
    draft = await _author_returning("definitely not json").propose(
        "load csv and plot", credentials=_CREDS
    )
    assert draft.backend == "template"


def test_keyword_pick_caps_at_four_selections() -> None:
    registry = _registry()
    catalog = {m.id: m for m in registry.all()}
    selected = pa_module._keyword_pick(
        "load csv filter plot classify embed kafka webhook",
        catalog,
    )
    assert len(selected) <= 4


def test_marker_for_skips_empty_input_and_output_segments() -> None:
    registry = _registry()
    catalog = {m.id: m for m in registry.all()}
    parse_csv = catalog["notebookflow.parse_csv"]
    marker = pa_module._marker_for("Load", parse_csv, [], ["df"])
    assert marker == "# @node: Load  [input]  out=df"
    marker = pa_module._marker_for("Filter", catalog["notebookflow.filter_rows"], ["Load.df"], [])
    assert marker == "# @node: Filter  [transform]  in=Load.df"
