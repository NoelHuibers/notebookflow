"""Ask — free-form Q&A backing the web-app's command palette.

The user opens the palette with Cmd/Ctrl+K, types a question, and the
engine pipes it to their chosen provider via the LLMClient gateway
(bring-your-own-key) or to a small keyword-driven template fallback when
no key is configured. The template fallback nudges the user to the right
button (Explain / Compose / Run) based on the intent in their prompt.

Mirrors the Explainer / PipelineAuthor template-fallback pattern so the
endpoint contract is always ``AskAnswer.answer != ""``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from notebookflow.core.dag import DAG, DAGEdge, DAGNode
from notebookflow.llm.client import LLMClient, LLMError
from notebookflow.llm.credentials import CredentialContext

_MAX_TOKENS = 1024

_SYSTEM_PROMPT = """You are NotebookFlow's AI copilot.

Answer the user's question directly and concisely.

If the user's question is about a specific pipeline (provided as JSON
below their question), ground your answer in that pipeline -- reference
specific node names. If no pipeline is provided, answer the data
engineering / Python / pandas question generally.

Output plain prose. No Markdown headings or fenced code blocks. Use a
bullet list only if the question explicitly asks for one. Keep it short
-- 2-4 sentences for simple questions; expand only when needed.
"""


@dataclass(slots=True)
class AskAnswer:
    answer: str
    backend: str  # the concrete provider used ("anthropic", "openai", …) or "template"
    warnings: list[str] = field(default_factory=list)


class Ask:
    """Wraps a single async ``ask`` entry point. Stateless and safe to share."""

    def __init__(self, llm: LLMClient | None = None) -> None:
        self._llm = llm if llm is not None else LLMClient()

    async def ask(
        self,
        prompt: str,
        dag: DAG | None = None,
        credentials: CredentialContext | None = None,
    ) -> AskAnswer:
        trimmed = prompt.strip()
        if trimmed == "":
            return AskAnswer(
                answer="Ask me anything about your pipeline or about data engineering in general.",
                backend="template",
            )

        if credentials is None:
            return AskAnswer(answer=_template_answer(trimmed, dag), backend="template")

        try:
            answer = await self._llm.complete(
                provider=credentials.provider,
                model=credentials.model,
                api_key=credentials.api_key,
                messages=[{"role": "user", "content": _build_user_message(trimmed, dag)}],
                system=_SYSTEM_PROMPT,
                max_tokens=_MAX_TOKENS,
            )
        except LLMError as exc:
            return AskAnswer(
                answer=_template_answer(trimmed, dag),
                backend="template",
                warnings=[f"{exc}; fell back to a template hint."],
            )
        return AskAnswer(answer=answer, backend=credentials.provider)


def _build_user_message(prompt: str, dag: DAG | None) -> str:
    if dag is None or not list(dag.topological_order()):
        return f"Question:\n{prompt}\n"
    pipeline = {
        "nodes": [
            {
                "id": node.id,
                "name": node.name,
                "tag": node.tag,
                "inputs": list(node.inputs),
                "outputs": list(node.outputs),
            }
            for node in dag.topological_order()
        ],
        "edges": [
            {
                "from": f"{edge.source_node_id}.{edge.source_port}",
                "to": f"{edge.target_node_id}.{edge.target_port}",
            }
            for edge in dag.edges()
        ],
    }
    return (
        f"Question:\n{prompt}\n\n"
        f"Current pipeline (topologically ordered):\n{json.dumps(pipeline, indent=2)}\n"
    )


# ---------------------------------------------------------------------------
# Template fallback
# ---------------------------------------------------------------------------

_INTENT_HINTS: tuple[tuple[tuple[str, ...], str], ...] = (
    (
        ("explain", "describe", "what does", "how does this pipeline", "walkthrough"),
        "Click the **Explain** button in the top bar to get a prose walkthrough of the "
        "current pipeline -- it routes through the same engine endpoint and works without "
        "an API key (template outline) or with one (Claude-authored prose).",
    ),
    (
        ("compose", "create a pipeline", "build a pipeline", "draft", "generate a pipeline"),
        "Click the **Compose** button in the top bar (Wand icon) to draft a fresh pipeline "
        "from a natural-language description. The engine maps your description to known "
        "node manifests and emits ready-to-run cells.",
    ),
    (
        ("synthesize", "write the code", "regenerate", "code synth"),
        "Add a node from the palette (or pick one on the canvas) and the engine's "
        "CodeSynth backend will regenerate the cell source from the manifest. With "
        "ANTHROPIC_API_KEY set the output is Claude-authored; without it you get the "
        "deterministic template render.",
    ),
    (
        ("trigger", "schedule", "cron", "watch", "webhook"),
        "Triggers (file_watch / cron / webhook / manual) are managed via the engine "
        "/triggers REST endpoints today. UI surface for editing them lands in #20.",
    ),
    (
        ("run", "execute", "kick off"),
        "Press **Cmd/Ctrl+Enter** or click **Run pipeline** in the top bar to execute the "
        "current notebook end-to-end. Outputs stream back through the WebSocket as each "
        "node finishes.",
    ),
)


def _template_answer(prompt: str, dag: DAG | None) -> str:
    summary = _pipeline_one_liner(dag)
    hint = _intent_hint(prompt)
    if hint is not None:
        return f"{summary}{hint}".strip() + "\n"
    return (
        f"{summary}I can answer richer questions once you add a provider + API key in "
        "Settings (bring-your-own-key). Without one I can still nudge you to the right "
        "button -- try keywords like 'explain', 'compose', 'run', or 'trigger'.\n"
    )


def _intent_hint(prompt: str) -> str | None:
    lowered = prompt.lower()
    for keywords, hint in _INTENT_HINTS:
        if any(keyword in lowered for keyword in keywords):
            return hint
    return None


def _pipeline_one_liner(dag: DAG | None) -> str:
    if dag is None:
        return ""
    ordered: list[DAGNode] = list(dag.topological_order())
    if not ordered:
        return ""
    edges: list[DAGEdge] = dag.edges()
    head = ordered[0].name
    tail = ordered[-1].name
    if head == tail:
        return f"Your pipeline has one node ({head}). "
    return (
        f"Your pipeline has {len(ordered)} nodes wired through "
        f"{len(edges)} edges, ending at '{tail}'. "
    )
