"""Explainer — graph -> literate prose description of the pipeline.

Used in the canvas sidebar and in generated docs: walks the DAG in
topological order and asks an LLM to produce a paragraph-per-section
overview of what the pipeline does.

Backends:
    * gateway: the user's chosen provider via the LLMClient (BYOK) when a
      CredentialContext is supplied.
    * template: deterministic outline derived from node names + tags +
      wires. Used when no key is configured, or as a fallback when the
      gateway call fails.

Callers can rely on ``ExplanationResult.prose`` always being non-empty.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from notebookflow.core.dag import DAG, DAGEdge, DAGNode
from notebookflow.llm.client import LLMClient, LLMError
from notebookflow.llm.credentials import CredentialContext

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
    backend: str  # the concrete provider used, or "template"
    warnings: list[str] = field(default_factory=list)


class Explainer:
    def __init__(self, llm: LLMClient | None = None) -> None:
        self._llm = llm if llm is not None else LLMClient()

    async def explain(
        self,
        dag: DAG,
        *,
        instruction: str = "",
        credentials: CredentialContext | None = None,
    ) -> ExplanationResult:
        ordered = dag.topological_order()
        edges = dag.edges()

        if credentials is None:
            return ExplanationResult(prose=_template_prose(ordered, edges), backend="template")

        try:
            prose = await self._llm.complete(
                provider=credentials.provider,
                model=credentials.model,
                api_key=credentials.api_key,
                messages=[{"role": "user", "content": _build_prompt(ordered, edges, instruction)}],
                system=_SYSTEM_PROMPT,
                max_tokens=_MAX_TOKENS,
            )
        except LLMError as exc:
            return ExplanationResult(
                prose=_template_prose(ordered, edges),
                backend="template",
                warnings=[f"{exc}; fell back to a template outline."],
            )
        return ExplanationResult(prose=prose, backend=credentials.provider)


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
