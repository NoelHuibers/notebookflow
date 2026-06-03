"""CodeSynth — generate the body of a single node from its manifest + intent.

Used when the user adds a custom node to the canvas: given the declared
inputs, outputs, and a short description, the LLM writes the cell source
that satisfies the manifest contract.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

import httpx

from notebookflow.protocol.loader import Loader
from notebookflow.protocol.manifest import NodeManifest
from notebookflow.protocol.registry import Registry

_SYSTEM_PROMPT = """You write Python source for exactly one notebook cell.

Return only raw Python code. Do not wrap the result in Markdown fences, do not
explain the code, and do not include a # @node marker line.

Runtime contract:
- Any upstream inputs are already injected into the cell namespace as Python
  variables named after their port names.
- The workflow runtime captures declared output port variables after the cell
  finishes. If outputs are declared, assign your main result to them.
- You may use the Python standard library plus pandas and matplotlib.
- Prefer concise, deterministic code.
"""


@dataclass(slots=True)
class SynthesisResult:
    source: str
    backend: str
    warnings: list[str] = field(default_factory=list)


class CodeSynth:
    def __init__(self, registry: Registry) -> None:
        self._loader = Loader(registry)

    async def synthesize(
        self,
        manifest: NodeManifest,
        *,
        node_name: str,
        inputs: list[str],
        outputs: list[str],
        config: dict[str, str],
        current_source: str = "",
    ) -> SynthesisResult:
        input_vars = _input_vars(manifest, inputs)
        output_vars = _output_vars(manifest, outputs)

        if manifest.generation_mode != "llm":
            return self._template_result(
                manifest,
                node_name=node_name,
                input_vars=input_vars,
                output_vars=output_vars,
                config=config,
            )

        api_key = _openai_api_key()
        if api_key is None:
            return self._template_result(
                manifest,
                node_name=node_name,
                input_vars=input_vars,
                output_vars=output_vars,
                config=config,
                warnings=[
                    "OpenAI is not configured. Set OPENAI_API_KEY or "
                    "NOTEBOOKFLOW_OPENAI_API_KEY in the shell or a local .env file "
                    "to enable LLM synthesis."
                ],
            )

        try:
            source = await self._synthesize_with_openai(
                manifest=manifest,
                node_name=node_name,
                input_vars=input_vars,
                output_vars=output_vars,
                config=config,
                current_source=current_source,
                api_key=api_key,
            )
        except (httpx.HTTPError, RuntimeError) as exc:
            return self._template_result(
                manifest,
                node_name=node_name,
                input_vars=input_vars,
                output_vars=output_vars,
                config=config,
                warnings=[_openai_failure_warning(exc)],
            )
        return SynthesisResult(source=source, backend="openai")

    def _template_result(
        self,
        manifest: NodeManifest,
        *,
        node_name: str,
        input_vars: list[str],
        output_vars: list[str],
        config: dict[str, str],
        warnings: list[str] | None = None,
    ) -> SynthesisResult:
        source = self._loader.render_template(
            manifest,
            {
                "node_name": node_name,
                "input_vars": input_vars,
                "output_vars": output_vars,
                "config": config,
            },
        )
        return SynthesisResult(source=source, backend="template", warnings=warnings or [])

    async def _synthesize_with_openai(
        self,
        *,
        manifest: NodeManifest,
        node_name: str,
        input_vars: list[str],
        output_vars: list[str],
        config: dict[str, str],
        current_source: str,
        api_key: str,
    ) -> str:
        base_url = os.environ.get("NOTEBOOKFLOW_OPENAI_BASE_URL", "https://api.openai.com/v1")
        model = os.environ.get("NOTEBOOKFLOW_OPENAI_MODEL", "gpt-4o-mini")
        prompt = self._build_prompt(
            manifest=manifest,
            node_name=node_name,
            input_vars=input_vars,
            output_vars=output_vars,
            config=config,
            current_source=current_source,
        )

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "temperature": 0.2,
                    "messages": [
                        {"role": "system", "content": _SYSTEM_PROMPT},
                        {"role": "user", "content": prompt},
                    ],
                },
            )
            response.raise_for_status()
            payload = response.json()

        content = _extract_message_text(payload)
        if content == "":
            raise RuntimeError("OpenAI returned an empty completion")
        stripped = _strip_code_fences(content).strip()
        return f"{stripped}\n" if stripped != "" else ""

    def _build_prompt(
        self,
        *,
        manifest: NodeManifest,
        node_name: str,
        input_vars: list[str],
        output_vars: list[str],
        config: dict[str, str],
        current_source: str,
    ) -> str:
        sections = [
            f"Manifest id: {manifest.id}",
            f"Node name: {node_name}",
            f"Tag: {manifest.tag}",
            f"Description: {manifest.description}",
            f"Input variables already available: {json.dumps(input_vars)}",
            f"Declared output variables to assign: {json.dumps(output_vars)}",
            f"Structured config: {json.dumps(config, indent=2, sort_keys=True)}",
        ]
        if current_source.strip() != "":
            sections.append("Current source to revise:\n" + current_source)
        sections.append(
            "Write the updated Python cell source now. Use the declared output variables exactly "
            "as given."
        )
        return "\n\n".join(sections)


def _input_vars(manifest: NodeManifest, refs: list[str]) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for ref in refs:
        if "." not in ref:
            continue
        port = ref.rsplit(".", 1)[1].strip()
        if port != "" and port not in seen:
            seen.add(port)
            names.append(port)
    if names:
        return names
    return [port.name for port in manifest.inputs]


def _output_vars(manifest: NodeManifest, outputs: list[str]) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for port in outputs:
        cleaned = port.strip()
        if cleaned != "" and cleaned not in seen:
            seen.add(cleaned)
            names.append(cleaned)
    if names:
        return names
    return [port.name for port in manifest.outputs]


def _openai_api_key() -> str | None:
    return os.environ.get("NOTEBOOKFLOW_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")


def _extract_message_text(payload: dict[str, object]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    message = first.get("message")
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            if isinstance(text, str):
                parts.append(text)
        return "\n".join(parts)
    return ""


def _strip_code_fences(source: str) -> str:
    stripped = source.strip()
    if not stripped.startswith("```"):
        return source
    lines = stripped.splitlines()
    if len(lines) >= 2 and lines[0].startswith("```") and lines[-1] == "```":
        return "\n".join(lines[1:-1])
    return source


def _openai_failure_warning(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        status_code = exc.response.status_code
        if status_code == 401:
            return (
                "OpenAI rejected the configured API key (401 Unauthorized). "
                "Check OPENAI_API_KEY or NOTEBOOKFLOW_OPENAI_API_KEY in .env or the shell, "
                "make sure it matches NOTEBOOKFLOW_OPENAI_BASE_URL if you changed the base URL, "
                "then restart the engine. Falling back to the template."
            )
        if status_code == 429:
            return "OpenAI rate limited the request (429). Falling back to the template."
        reason = exc.response.reason_phrase or "request failed"
        return (
            f"OpenAI request failed with {status_code} {reason}. "
            "Falling back to the template."
        )
    return f"OpenAI synthesis failed, falling back to the template: {exc}"
