"""Tests for LLM PipelineAuthor (natural-language → pipeline draft)."""

from __future__ import annotations

import httpx
import pytest

from notebookflow.llm import pipeline_author as pa_module
from notebookflow.llm.pipeline_author import PipelineAuthor, PipelineDraft
from notebookflow.nodes import register as register_builtins
from notebookflow.protocol.registry import Registry


def _registry() -> Registry:
    registry = Registry()
    register_builtins(registry)
    return registry


async def test_template_backend_picks_csv_filter_plot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)

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
    # Cell sources are wired with markers + executable bodies.
    assert all(src.startswith("# @node:") for src in draft.cell_sources)
    assert any("read_csv" in src for src in draft.cell_sources)
    # Edges connect adjacent nodes in declared order.
    assert len(draft.edges) == len(draft.nodes) - 1


async def test_template_backend_returns_demo_when_no_keywords_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)

    author = PipelineAuthor(_registry())
    draft = await author.propose("zzz nothing matches here")
    assert draft.backend == "template"
    # The fallback walks parse_csv -> filter_rows -> plot_chart so users always
    # see a runnable starting point.
    assert [node["manifest_id"] for node in draft.nodes] == [
        "notebookflow.parse_csv",
        "notebookflow.filter_rows",
        "notebookflow.plot_chart",
    ]


async def test_template_draft_with_empty_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NOTEBOOKFLOW_ANTHROPIC_API_KEY", raising=False)

    author = PipelineAuthor(Registry())
    draft = await author.propose("Load CSV and plot.")
    assert draft.nodes == []
    assert draft.cell_sources == []
    assert "no manifests" in draft.warnings[0].lower()


async def test_anthropic_backend_materialises_valid_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key")

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

    async def fake_post(
        _self: httpx.AsyncClient, *_args: object, **_kwargs: object
    ) -> httpx.Response:
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        return httpx.Response(
            status_code=200,
            request=request,
            json={"content": [{"type": "text", "text": payload_text}]},
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    draft = await PipelineAuthor(_registry()).propose("anything")
    assert draft.backend == "anthropic"
    assert [node["name"] for node in draft.nodes] == ["Load CSV", "Filter EU", "Plot"]
    # Anthropic-supplied config makes it through.
    load_csv = draft.nodes[0]
    assert load_csv["config"]["path"] == "sales.csv"
    # Cell sources still carry markers + are non-empty.
    assert all("# @node:" in src for src in draft.cell_sources)


async def test_anthropic_response_strips_code_fences(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key")

    fenced = (
        "```json\n"
        '{"nodes": ['
        ' {"manifest_id": "notebookflow.parse_csv", "name": "Load", "config": {}}],'
        ' "edges": []}\n'
        "```"
    )

    async def fake_post(
        _self: httpx.AsyncClient, *_args: object, **_kwargs: object
    ) -> httpx.Response:
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        return httpx.Response(
            status_code=200,
            request=request,
            json={"content": [{"type": "text", "text": fenced}]},
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    draft = await PipelineAuthor(_registry()).propose("load csv")
    assert draft.backend == "anthropic"
    assert len(draft.nodes) == 1


async def test_anthropic_unknown_manifest_ids_are_dropped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key")

    payload_text = (
        '{"nodes": ['
        ' {"manifest_id": "notebookflow.parse_csv", "name": "Load", "config": {}},'
        ' {"manifest_id": "notebookflow.bogus_node", "name": "Bogus", "config": {}}],'
        ' "edges": []}'
    )

    async def fake_post(
        _self: httpx.AsyncClient, *_args: object, **_kwargs: object
    ) -> httpx.Response:
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        return httpx.Response(
            status_code=200,
            request=request,
            json={"content": [{"type": "text", "text": payload_text}]},
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    draft = await PipelineAuthor(_registry()).propose("ignore")
    assert [node["manifest_id"] for node in draft.nodes] == ["notebookflow.parse_csv"]


async def test_anthropic_failure_falls_back_to_template(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key")

    async def failing_post(
        _self: httpx.AsyncClient, *_args: object, **_kwargs: object
    ) -> httpx.Response:
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        response = httpx.Response(status_code=502, request=request)
        raise httpx.HTTPStatusError("Anthropic 502", request=request, response=response)

    monkeypatch.setattr(httpx.AsyncClient, "post", failing_post)
    draft = await PipelineAuthor(_registry()).propose("plot revenue by region")
    assert draft.backend == "template"
    assert draft.warnings != []
    assert "fell back" in draft.warnings[0].lower()


async def test_anthropic_empty_response_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key")

    async def empty_post(
        _self: httpx.AsyncClient, *_args: object, **_kwargs: object
    ) -> httpx.Response:
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        return httpx.Response(status_code=200, request=request, json={"content": []})

    monkeypatch.setattr(httpx.AsyncClient, "post", empty_post)
    draft = await PipelineAuthor(_registry()).propose("plot revenue by region")
    assert draft.backend == "template"
    assert any("empty" in w.lower() for w in draft.warnings)


async def test_anthropic_invalid_json_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key")

    async def bad_json(
        _self: httpx.AsyncClient, *_args: object, **_kwargs: object
    ) -> httpx.Response:
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        return httpx.Response(
            status_code=200,
            request=request,
            json={"content": [{"type": "text", "text": "definitely not json"}]},
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", bad_json)
    draft = await PipelineAuthor(_registry()).propose("load csv and plot")
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
