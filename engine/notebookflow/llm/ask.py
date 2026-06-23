"""Ask — free-form Q&A backing the web-app's command palette.

The user opens the palette with Cmd/Ctrl+K, types a question, and the
engine pipes it to Claude (when ANTHROPIC_API_KEY is set) or to a small
keyword-driven template fallback (otherwise). The template fallback
exists so the palette is useful for self-hosters without an API key --
it nudges them to the right button (Explain / Compose / Run) based on
the intent it can detect in their prompt.

Mirrors the Explainer / PipelineAuthor template-fallback pattern so the
endpoint contract is always ``AskAnswer.answer != ""``.
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
    backend: str  # "anthropic" or "template"
    warnings: list[str] = field(default_factory=list)


class Ask:
    """Wraps a single async ``ask`` entry point, mirroring Explainer.

    Stateless: one instance per app is fine; concurrent calls are safe
    because each call opens its own httpx.AsyncClient.
    """

    async def ask(self, prompt: str, dag: DAG | None = None) -> AskAnswer:
        trimmed = prompt.strip()
        if trimmed == "":
            return AskAnswer(
                answer="Ask me anything about your pipeline or about data engineering in general.",
                backend="template",
            )

        api_key = _anthropic_api_key()
        if api_key is None:
            return AskAnswer(answer=_template_answer(trimmed, dag), backend="template")

        try:
            answer = await self._ask_with_anthropic(
                prompt=trimmed,
                dag=dag,
                api_key=api_key,
            )
        except (httpx.HTTPError, RuntimeError) as exc:
            return AskAnswer(
                answer=_template_answer(trimmed, dag),
                backend="template",
                warnings=[_anthropic_failure_warning(exc)],
            )
        if answer == "":
            return AskAnswer(
                answer=_template_answer(trimmed, dag),
                backend="template",
                warnings=["Anthropic returned an empty response; fell back to a template hint"],
            )
        return AskAnswer(answer=answer, backend="anthropic")

    async def _ask_with_anthropic(
        self,
        *,
        prompt: str,
        dag: DAG | None,
        api_key: str,
    ) -> str:
        base_url = os.environ.get(
            "NOTEBOOKFLOW_ANTHROPIC_BASE_URL",
            _DEFAULT_ANTHROPIC_BASE_URL,
        )
        model = os.environ.get("NOTEBOOKFLOW_ANTHROPIC_MODEL", _DEFAULT_ANTHROPIC_MODEL)
        user_message = _build_user_message(prompt, dag)

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
                    "messages": [{"role": "user", "content": user_message}],
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
        "fell back to a deterministic template hint."
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
        f"{summary}I can answer richer questions when ANTHROPIC_API_KEY is set on the "
        "engine. Without a key I can still nudge you to the right button -- try keywords "
        "like 'explain', 'compose', 'run', or 'trigger'.\n"
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
