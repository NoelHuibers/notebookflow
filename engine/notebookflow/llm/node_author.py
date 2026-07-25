"""NodeAuthor — natural-language description -> a single structured node.

Given a plain-English description of ONE node plus the outputs of the nodes
already on the canvas (the upstream context), asks the user's chosen provider
(via the LLMClient gateway) to design a node: a name, tag, input bindings,
output ports, and a Python body. Returns a ``NodeDraft`` the canvas drops onto
the graph and auto-wires to its upstream sources.

Backends mirror the other feature modules:
    * gateway: the user's provider via the LLMClient (bring-your-own-key), a
      JSON-only system prompt (from ``llm.prompts``), and validation against the
      supplied context so the model can't reference nodes/ports that don't
      exist.
    * template: a deterministic transform-stub used when no key is configured or
      the LLM call fails, so ``/nodes/author`` ALWAYS returns a usable node.

Input bindings use the contract-binding grammar ``local<-Node.port``; the
canvas writes them into the node's ``# @node:`` marker and the SyncEngine
resolves them to wires (``recomputeAllWires``). This module returns only the
structured draft -- the marker is owned client-side.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from notebookflow.llm.client import LLMClient, LLMError
from notebookflow.llm.credentials import CredentialContext
from notebookflow.llm.prompts import NODE_TAGS, node_author_system_prompt
from notebookflow.protocol.registry import Registry

_MAX_TOKENS = 1024
_DEFAULT_TAG = "transform"

# Copied verbatim from CodeSynth so the "no key" experience is identical across
# the AI features.
_NO_PROVIDER_WARNING = (
    "No AI provider configured. Add a provider + API key in Settings "
    "(bring-your-own-key) to enable LLM synthesis."
)


@dataclass(slots=True)
class UpstreamOutputs:
    """One upstream node the new node may bind to: its name + output ports."""

    node_name: str
    output_ports: list[str] = field(default_factory=list)


@dataclass(slots=True)
class NodeAuthorContext:
    """What the author knows about the canvas: available upstream outputs and an
    optional notebook name (currently advisory, reserved for prompt context)."""

    upstream: list[UpstreamOutputs] = field(default_factory=list)
    notebook_name: str = ""


@dataclass(slots=True)
class NodeDraft:
    """A single node the canvas can place + auto-wire.

    ``inputs`` are contract-binding strings ``local<-Node.port``; ``outputs`` are
    Python identifiers; ``body`` is the cell source WITHOUT a marker line.
    """

    name: str
    tag: str
    inputs: list[str] = field(default_factory=list)
    outputs: list[str] = field(default_factory=list)
    body: str = ""
    backend: str = "template"
    warnings: list[str] = field(default_factory=list)


class NodeAuthor:
    def __init__(self, registry: Registry, llm: LLMClient | None = None) -> None:
        self._registry = registry
        self._llm = llm if llm is not None else LLMClient()

    async def author(
        self,
        description: str,
        *,
        context: NodeAuthorContext | None = None,
        credentials: CredentialContext | None = None,
    ) -> NodeDraft:
        ctx = context if context is not None else NodeAuthorContext()

        if credentials is None:
            return self._template_draft(description, ctx, warnings=[_NO_PROVIDER_WARNING])

        try:
            payload = await self._author_with_gateway(description, ctx, credentials)
        except (LLMError, ValueError) as exc:
            fallback = self._template_draft(description, ctx)
            fallback.warnings = [f"{exc}; fell back to a template node.", *fallback.warnings]
            return fallback

        draft, warnings = _validate(payload, ctx, backend=credentials.provider)
        if draft is None:
            fallback = self._template_draft(description, ctx)
            fallback.warnings = [*warnings, *fallback.warnings]
            return fallback
        return draft

    async def _author_with_gateway(
        self,
        description: str,
        context: NodeAuthorContext,
        credentials: CredentialContext,
    ) -> dict[str, object]:
        text = await self._llm.complete(
            provider=credentials.provider,
            model=credentials.model,
            api_key=credentials.api_key,
            messages=[{"role": "user", "content": _build_prompt(description, context)}],
            system=node_author_system_prompt(),
            max_tokens=_MAX_TOKENS,
        )
        cleaned = _strip_code_fences(text)
        try:
            payload = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            raise ValueError(f"LLM JSON parse failed: {exc}") from exc
        if not isinstance(payload, dict):
            raise ValueError("LLM response is not a JSON object")
        return payload

    def _template_draft(
        self,
        description: str,
        context: NodeAuthorContext,
        *,
        warnings: list[str] | None = None,
    ) -> NodeDraft:
        """Deterministic transform stub so the endpoint always returns a node.

        Best-effort binds every output port of the FIRST upstream node so the
        placed node still auto-wires; the body references those variables and
        leaves a TODO for the user to finish.
        """
        name = _slug_to_name(description)
        bindings: list[str] = []
        input_vars: list[str] = []
        if context.upstream:
            first = context.upstream[0]
            for port in first.output_ports:
                local = _sanitise_identifier(port) or "data"
                if local in input_vars:
                    continue
                input_vars.append(local)
                bindings.append(f"{local}<-{first.node_name}.{port}")

        output_name = "result"
        if input_vars:
            refs = ", ".join(input_vars)
            body = (
                f"# TODO: {description.strip() or 'implement this node'}\n"
                f"# Available inputs: {refs}\n"
                f"{output_name} = {input_vars[0]}\n"
            )
        else:
            body = (
                f"# TODO: {description.strip() or 'implement this node'}\n"
                f"{output_name} = None\n"
            )
        return NodeDraft(
            name=name,
            tag=_DEFAULT_TAG,
            inputs=bindings,
            outputs=[output_name],
            body=body,
            backend="template",
            warnings=warnings or [],
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_prompt(description: str, context: NodeAuthorContext) -> str:
    upstream = [
        {"node_name": node.node_name, "output_ports": list(node.output_ports)}
        for node in context.upstream
    ]
    sections = [
        "Upstream context (nodes already on the canvas and their output ports):",
        json.dumps(upstream, indent=2),
    ]
    if context.notebook_name.strip() != "":
        sections.append(f"Notebook: {context.notebook_name.strip()}")
    sections.append(f"Request:\n{description.strip()}")
    sections.append("Author the node now.")
    return "\n\n".join(sections)


def _validate(
    payload: dict[str, object],
    context: NodeAuthorContext,
    *,
    backend: str,
) -> tuple[NodeDraft | None, list[str]]:
    """Validate a gateway payload into a NodeDraft.

    Returns ``(draft, warnings)``; ``draft`` is None when the body is empty (the
    caller then falls back to the template). Individual field problems (bad tag,
    hallucinated binding, invalid output) are coerced/dropped with a warning
    rather than failing the whole draft.
    """
    warnings: list[str] = []

    name = payload.get("name")
    if not isinstance(name, str) or name.strip() == "":
        name = "New Node"

    tag = payload.get("tag")
    if not isinstance(tag, str) or tag not in NODE_TAGS:
        warnings.append(f"Unknown tag {tag!r}; defaulted to {_DEFAULT_TAG!r}.")
        tag = _DEFAULT_TAG

    # Build a lookup of the ports each upstream node actually exposes.
    available: dict[str, set[str]] = {
        node.node_name: set(node.output_ports) for node in context.upstream
    }

    inputs: list[str] = []
    raw_inputs = payload.get("inputs", [])
    if isinstance(raw_inputs, list):
        for raw in raw_inputs:
            if not isinstance(raw, str) or "<-" not in raw:
                continue
            local, _, source = raw.partition("<-")
            local = local.strip()
            source = source.strip()
            node_name, _, port = source.rpartition(".")
            if local == "" or node_name == "" or port == "":
                continue
            if node_name not in available or port not in available[node_name]:
                warnings.append(f"Dropped input {source!r}: no such upstream output.")
                continue
            binding = f"{local}<-{node_name}.{port}"
            if binding not in inputs:
                inputs.append(binding)

    outputs: list[str] = []
    raw_outputs = payload.get("outputs", [])
    if isinstance(raw_outputs, list):
        for raw in raw_outputs:
            if not isinstance(raw, str):
                continue
            cleaned = raw.strip()
            if not cleaned.isidentifier():
                warnings.append(f"Dropped output {raw!r}: not a valid Python identifier.")
                continue
            if cleaned not in outputs:
                outputs.append(cleaned)

    body = payload.get("body")
    if not isinstance(body, str) or body.strip() == "":
        warnings.append("LLM returned an empty body; fell back to a template node.")
        return None, warnings

    return (
        NodeDraft(
            name=name.strip(),
            tag=tag,
            inputs=inputs,
            outputs=outputs,
            body=body if body.endswith("\n") else f"{body}\n",
            backend=backend,
            warnings=warnings,
        ),
        warnings,
    )


def _strip_code_fences(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```[a-zA-Z]*\n", "", stripped)
        if stripped.endswith("```"):
            stripped = stripped[: -len("```")]
    return stripped.strip()


def _slug_to_name(description: str) -> str:
    """Human-readable node name from the first few words of the description."""
    words = re.findall(r"[A-Za-z0-9]+", description)
    if not words:
        return "New Node"
    return " ".join(word.capitalize() for word in words[:4])


def _sanitise_identifier(raw: str) -> str:
    """Coerce a port name into a Python identifier, or "" if impossible."""
    cleaned = re.sub(r"\W", "_", raw.strip())
    cleaned = re.sub(r"^[^A-Za-z_]+", "", cleaned)
    return cleaned if cleaned.isidentifier() else ""
