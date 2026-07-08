"""CodeSynth — generate the body of a single node from its manifest + intent.

Used when the user adds a custom node to the canvas: given the declared
inputs, outputs, and a short description, the LLM writes the cell source
that satisfies the manifest contract.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from notebookflow.llm.client import LLMClient, LLMError
from notebookflow.llm.credentials import CredentialContext
from notebookflow.protocol.loader import Loader
from notebookflow.protocol.manifest import NodeManifest
from notebookflow.protocol.registry import Registry

_MAX_TOKENS = 1024

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
    def __init__(self, registry: Registry, llm: LLMClient | None = None) -> None:
        self._loader = Loader(registry)
        self._llm = llm if llm is not None else LLMClient()

    async def synthesize(
        self,
        manifest: NodeManifest,
        *,
        node_name: str,
        inputs: list[str],
        outputs: list[str],
        config: dict[str, str],
        current_source: str = "",
        credentials: CredentialContext | None = None,
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

        if credentials is None:
            return self._template_result(
                manifest,
                node_name=node_name,
                input_vars=input_vars,
                output_vars=output_vars,
                config=config,
                warnings=[
                    "No AI provider configured. Add a provider + API key in Settings "
                    "(bring-your-own-key) to enable LLM synthesis."
                ],
            )

        try:
            source = await self._synthesize_with_gateway(
                manifest=manifest,
                node_name=node_name,
                input_vars=input_vars,
                output_vars=output_vars,
                config=config,
                current_source=current_source,
                credentials=credentials,
            )
        except LLMError as exc:
            return self._template_result(
                manifest,
                node_name=node_name,
                input_vars=input_vars,
                output_vars=output_vars,
                config=config,
                warnings=[f"{exc}; fell back to the template."],
            )
        return SynthesisResult(source=source, backend=credentials.provider)

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

    async def _synthesize_with_gateway(
        self,
        *,
        manifest: NodeManifest,
        node_name: str,
        input_vars: list[str],
        output_vars: list[str],
        config: dict[str, str],
        current_source: str,
        credentials: CredentialContext,
    ) -> str:
        prompt = self._build_prompt(
            manifest=manifest,
            node_name=node_name,
            input_vars=input_vars,
            output_vars=output_vars,
            config=config,
            current_source=current_source,
        )
        content = await self._llm.complete(
            provider=credentials.provider,
            model=credentials.model,
            api_key=credentials.api_key,
            messages=[{"role": "user", "content": prompt}],
            system=_SYSTEM_PROMPT,
            max_tokens=_MAX_TOKENS,
        )
        stripped = _strip_code_fences(content).strip()
        if stripped == "":
            raise LLMError(f"{credentials.provider} returned an empty completion")
        return f"{stripped}\n"

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
    for binding in refs:
        if "<-" not in binding:
            continue
        local_name = binding.split("<-", 1)[0].strip()
        if local_name != "" and local_name not in seen:
            seen.add(local_name)
            names.append(local_name)
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


def _strip_code_fences(source: str) -> str:
    stripped = source.strip()
    if not stripped.startswith("```"):
        return source
    lines = stripped.splitlines()
    if len(lines) >= 2 and lines[0].startswith("```") and lines[-1] == "```":
        return "\n".join(lines[1:-1])
    return source
