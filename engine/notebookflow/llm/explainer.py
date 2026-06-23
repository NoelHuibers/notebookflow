"""Explainer — graph -> literate prose description of the pipeline.

Used in the canvas sidebar and in generated docs: walks the DAG in
topological order and asks an LLM to produce a paragraph-per-section
overview of what the pipeline does.

Backends:
    * anthropic: HTTPX call to Claude when ANTHROPIC_API_KEY or
      NOTEBOOKFLOW_ANTHROPIC_API_KEY is set.
    * template: deterministic outline derived from node names + tags +
      wires. Used when no API key is configured, or as a fallback when
      the Anthropic call fails.

Mirrors the CodeSynth fallback pattern so callers can rely on
``ExplanationResult.prose`` always being non-empty.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any

import httpx

from notebookflow.core.dag import DAG, DAGEdge, DAGNode

_DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6"
_DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com"
_ANTHROPIC_VERSION = "2023-06-01"
_MAX_TOKENS = 1024

_SYSTEM_PROMPT = """You explain data pipelines to a technical reader.

Given a topologically-ordered list of pipeline nodes plus the wires between
them, write a short prose walkthrough that:
- Opens with one sentence describing the pipeline's overall purpose.
- Walks through each node in order. For each, name the node, its tag, what
  it consumes, and what it produces. One short paragraph per node.
- Closes with one sentence summarising the end-to-end data flow.

Output plain prose only. No Markdown headings, no bullet lists, no code
fences. Be concise -- a reader should be able to read the entire output
in under a minute.
"""


@dataclass(slots=True)
class ExplanationResult:
    prose: str
    backend: str  # "anthropic" or "template"
    warnings: list[str] = field(default_factory=list)


class Explainer:
    async def explain(self, dag: DAG, *, instruction: str = "") -> ExplanationResult:
        ordered = dag.topological_order()
        edges = dag.edges()

        api_key = _anthropic_api_key()
        if api_key is None:
            return ExplanationResult(prose=_template_prose(ordered, edges), backend="template")

        try:
            prose = await self._explain_with_anthropic(
                ordered=ordered,
                edges=edges,
                instruction=instruction,
                api_key=api_key,
            )
        except (httpx.HTTPError, RuntimeError) as exc:
            return ExplanationResult(
                prose=_template_prose(ordered, edges),
                backend="template",
                warnings=[_anthropic_failure_warning(exc)],
            )
        if prose == "":
            return ExplanationResult(
                prose=_template_prose(ordered, edges),
                backend="template",
                warnings=["Anthropic returned an empty response; fell back to template outline"],
            )
        return ExplanationResult(prose=prose, backend="anthropic")

    async def _explain_with_anthropic(
        self,
        *,
        ordered: list[DAGNode],
        edges: list[DAGEdge],
        instruction: str,
        api_key: str,
    ) -> str:
        base_url = os.environ.get(
            "NOTEBOOKFLOW_ANTHROPIC_BASE_URL",
            _DEFAULT_ANTHROPIC_BASE_URL,
        )
        model = os.environ.get("NOTEBOOKFLOW_ANTHROPIC_MODEL", _DEFAULT_ANTHROPIC_MODEL)
        prompt = _build_prompt(ordered, edges, instruction)

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{base_url.rstrip('/')}/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": _ANTHROPIC_VERSION,
                    "content-type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": _MAX_TOKENS,
                    "system": _SYSTEM_PROMPT,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            response.raise_for_status()
            payload = response.json()

        return _extract_anthropic_text(payload)


def _anthropic_api_key() -> str | None:
    return os.environ.get("NOTEBOOKFLOW_ANTHROPIC_API_KEY") or os.environ.get(
        "ANTHROPIC_API_KEY",
    )


def _anthropic_failure_warning(exc: Exception) -> str:
    return (
        f"Anthropic call failed ({type(exc).__name__}: {exc}); "
        "fell back to a deterministic template outline."
    )


def _extract_anthropic_text(payload: dict[str, Any]) -> str:
    blocks = payload.get("content")
    if not isinstance(blocks, list):
        return ""
    parts: list[str] = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        if block.get("type") != "text":
            continue
        text = block.get("text")
        if isinstance(text, str):
            parts.append(text)
    return "".join(parts).strip()


def _build_prompt(ordered: list[DAGNode], edges: list[DAGEdge], instruction: str) -> str:
    pipeline = {
        "nodes": [
            {
                "id": node.id,
                "name": node.name,
                "tag": node.tag,
                "inputs": list(node.inputs),
                "outputs": list(node.outputs),
            }
            for node in ordered
        ],
        "edges": [
            {
                "from": f"{edge.source_node_id}.{edge.source_port}",
                "to": f"{edge.target_node_id}.{edge.target_port}",
            }
            for edge in edges
        ],
    }
    trimmed = instruction.strip()
    instruction_block = (
        f"\n\nAdditional context from the requester:\n{trimmed}\n" if trimmed != "" else ""
    )
    return (
        "Here is the pipeline in topological order, as JSON:\n\n"
        f"{json.dumps(pipeline, indent=2)}\n"
        f"{instruction_block}\n"
        "Write the walkthrough now."
    )


def _template_prose(ordered: list[DAGNode], edges: list[DAGEdge]) -> str:
    """Deterministic outline used when no LLM is configured."""
    if not ordered:
        return "Pipeline is empty.\n"
    incoming = _incoming_map(ordered, edges)
    lines: list[str] = [
        f"This pipeline chains {len(ordered)} "
        f"{'node' if len(ordered) == 1 else 'nodes'} in topological order.",
    ]
    for node in ordered:
        upstream = incoming.get(node.id, [])
        consumes = (
            "no upstream inputs" if not upstream else "consumes " + ", ".join(sorted(upstream))
        )
        produces = (
            "produces no outputs"
            if not node.outputs
            else "produces " + ", ".join(node.outputs)
        )
        lines.append(f"{node.name} ({node.tag}) {consumes}; it {produces}.")
    head = ordered[0].name
    tail = ordered[-1].name
    if head != tail:
        lines.append(f"Data flows end-to-end from {head} to {tail}.")
    return "\n\n".join(lines) + "\n"


def _incoming_map(ordered: list[DAGNode], edges: list[DAGEdge]) -> dict[str, list[str]]:
    name_by_id = {node.id: node.name for node in ordered}
    result: dict[str, list[str]] = {node.id: [] for node in ordered}
    for edge in edges:
        upstream_name = name_by_id.get(edge.source_node_id, edge.source_node_id)
        result.setdefault(edge.target_node_id, []).append(upstream_name)
    return result
