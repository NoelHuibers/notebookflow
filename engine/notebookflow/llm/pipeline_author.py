"""PipelineAuthor — natural-language description -> full pipeline graph.

Given a user prompt and the current node registry, asks the user's chosen
provider (via the LLMClient gateway) to propose a graph (nodes + wires) using
only manifests that exist. Returns a ``PipelineDraft`` the web-app can either
preview or apply as a fresh notebook.

Backends:
    * gateway: the user's provider via the LLMClient (bring-your-own-key) with
      a JSON-only system prompt and a registry summary scoped to the live
      manifests. Result is validated against the registry so the LLM can't
      reference unknown nodes.
    * template: keyword-match heuristic over manifest names + descriptions.
      Used when no key is configured or the LLM call fails. Returns a
      best-effort 1-3 node draft so the demo still produces something.

Both backends end up calling ``Loader.render_template`` per node so the
returned cell sources are immediately runnable -- and each carries a
``# @node:`` marker the SyncEngine can re-ingest.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from notebookflow.llm.client import LLMClient, LLMError
from notebookflow.llm.credentials import CredentialContext
from notebookflow.protocol.loader import Loader
from notebookflow.protocol.manifest import NodeManifest
from notebookflow.protocol.registry import Registry

_MAX_TOKENS = 2048

_SYSTEM_PROMPT = """You design notebook pipelines as JSON.

Output ONLY a JSON object that matches this exact schema:

{
  "nodes": [
    {
      "manifest_id": "<one of the registered manifest ids the user provided>",
      "name": "<short human-readable name, used as the marker name>",
      "config": {"<config key>": "<config value>"}
    }
  ],
  "edges": [
    {"from": "<NodeName>.<output port>", "to": "<NodeName>.<input port>"}
  ]
}

Rules:
- Use only manifest ids that appear in the catalog.
- Cite at least 2 nodes when the user asks for any non-trivial pipeline; 3+ is preferred.
- Nodes are listed in topological order.
- Edge "from"/"to" references match the human-readable names you assigned, not manifest ids.
- Config values must be plain strings; quote numbers as strings if needed.
- Do not include markdown, comments, or any text outside the JSON.
"""

# Lightweight keyword index used by the template fallback when no LLM is
# configured. Each tuple is (keyword, manifest_id). The first hit per keyword
# wins; ordering of the tuples matters for fall-through heuristics.
_KEYWORD_MAP: tuple[tuple[str, str], ...] = (
    ("csv", "notebookflow.parse_csv"),
    ("read", "notebookflow.parse_csv"),
    ("load", "notebookflow.parse_csv"),
    ("import", "notebookflow.parse_csv"),
    ("sql", "notebookflow.sql_query"),
    ("query", "notebookflow.sql_query"),
    ("database", "notebookflow.sql_query"),
    ("filter", "notebookflow.filter_rows"),
    ("where", "notebookflow.filter_rows"),
    ("select", "notebookflow.filter_rows"),
    ("transform", "notebookflow.ai_python_transform"),
    ("classify", "notebookflow.classify"),
    ("label", "notebookflow.classify"),
    ("embed", "notebookflow.embed"),
    ("vector", "notebookflow.embed"),
    ("generate", "notebookflow.llm_generate"),
    ("summari", "notebookflow.llm_generate"),
    ("answer", "notebookflow.llm_generate"),
    ("plot", "notebookflow.plot_chart"),
    ("chart", "notebookflow.plot_chart"),
    ("visuali", "notebookflow.plot_chart"),
    ("graph", "notebookflow.plot_chart"),
    ("kafka", "notebookflow.kafka_produce"),
    ("publish", "notebookflow.kafka_produce"),
    ("stream", "notebookflow.kafka_produce"),
    ("webhook", "notebookflow.webhook_post"),
    ("post", "notebookflow.webhook_post"),
    ("notify", "notebookflow.webhook_post"),
)


@dataclass(slots=True)
class PipelineDraft:
    """A draft pipeline the canvas can preview or apply.

    ``cell_sources`` is the list ready to drop straight into a new notebook --
    each entry already carries its ``# @node:`` marker. ``nodes`` + ``edges``
    expose the structured form for preview UIs that want to enumerate the
    proposal before committing.
    """

    notebook_path: str
    cell_sources: list[str]
    nodes: list[dict[str, Any]] = field(default_factory=list)
    edges: list[dict[str, str]] = field(default_factory=list)
    backend: str = "template"
    warnings: list[str] = field(default_factory=list)


class PipelineAuthor:
    def __init__(self, registry: Registry, llm: LLMClient | None = None) -> None:
        self._registry = registry
        self._loader = Loader(registry)
        self._llm = llm if llm is not None else LLMClient()

    async def propose(
        self,
        prompt: str,
        *,
        notebook_path: str = "generated.ipynb",
        credentials: CredentialContext | None = None,
    ) -> PipelineDraft:
        manifests = list(self._registry.all())
        if not manifests:
            return PipelineDraft(
                notebook_path=notebook_path,
                cell_sources=[],
                warnings=["No manifests registered; cannot draft a pipeline."],
            )

        if credentials is None:
            return self._template_draft(prompt, notebook_path=notebook_path, manifests=manifests)

        try:
            structured = await self._propose_with_gateway(
                prompt=prompt,
                credentials=credentials,
                manifests=manifests,
            )
        except (LLMError, ValueError) as exc:
            fallback = self._template_draft(
                prompt,
                notebook_path=notebook_path,
                manifests=manifests,
            )
            fallback.warnings = [f"{exc}; fell back to a template draft.", *fallback.warnings]
            return fallback

        if not structured["nodes"]:
            fallback = self._template_draft(
                prompt,
                notebook_path=notebook_path,
                manifests=manifests,
            )
            fallback.warnings = [
                f"{credentials.provider} returned no usable nodes; fell back to template draft.",
                *fallback.warnings,
            ]
            return fallback
        return self._materialise(
            structured,
            notebook_path=notebook_path,
            backend=credentials.provider,
        )

    async def _propose_with_gateway(
        self,
        *,
        prompt: str,
        credentials: CredentialContext,
        manifests: list[NodeManifest],
    ) -> dict[str, Any]:
        text = await self._llm.complete(
            provider=credentials.provider,
            model=credentials.model,
            api_key=credentials.api_key,
            messages=[{"role": "user", "content": _build_prompt(prompt, manifests)}],
            system=_SYSTEM_PROMPT,
            max_tokens=_MAX_TOKENS,
        )
        return _parse_and_validate(text, manifests)

    def _template_draft(
        self,
        prompt: str,
        *,
        notebook_path: str,
        manifests: list[NodeManifest],
    ) -> PipelineDraft:
        catalog = {m.id: m for m in manifests}
        selected_ids = _keyword_pick(prompt, catalog)
        if not selected_ids:
            # As a last resort, propose the canonical parse-csv -> filter -> plot
            # demo so the user always gets something to look at.
            for fallback_id in (
                "notebookflow.parse_csv",
                "notebookflow.filter_rows",
                "notebookflow.plot_chart",
            ):
                if fallback_id in catalog:
                    selected_ids.append(fallback_id)
        nodes = [
            {
                "manifest_id": mid,
                "name": _default_node_name(catalog[mid]),
                "config": {f.key: f.default_value for f in catalog[mid].config_fields},
            }
            for mid in selected_ids
            if mid in catalog
        ]
        edges = _heuristic_edges(nodes, catalog)
        structured = {"nodes": nodes, "edges": edges}
        return self._materialise(structured, notebook_path=notebook_path, backend="template")

    def _materialise(
        self,
        structured: dict[str, Any],
        *,
        notebook_path: str,
        backend: str,
    ) -> PipelineDraft:
        nodes = structured["nodes"]
        edges = structured["edges"]
        catalog = {m.id: m for m in self._registry.all()}
        # Build an in-port lookup so every node knows which upstream node feeds it.
        incoming: dict[str, list[str]] = {n["name"]: [] for n in nodes}
        for edge in edges:
            target_name = edge["to"].split(".", 1)[0]
            incoming.setdefault(target_name, []).append(edge["from"])

        cell_sources: list[str] = []
        for node in nodes:
            manifest = catalog[node["manifest_id"]]
            marker_inputs = incoming.get(node["name"], [])
            # Template port-name vars (the actual Python identifiers bound in
            # the cell namespace) are the last segment of each marker ref --
            # e.g. "Parse CSV.df" -> "df". The marker itself keeps the full
            # name.port form because the SyncEngine routes by that.
            input_vars = [ref.rsplit(".", 1)[1] for ref in marker_inputs if "." in ref] or [
                p.name for p in manifest.inputs
            ]
            output_vars = [p.name for p in manifest.outputs]
            # Start with the manifest defaults so optional config keys the LLM
            # didn't bother filling in still resolve in the template. The
            # user-supplied config overlays on top.
            config = {f.key: f.default_value for f in manifest.config_fields}
            for key, value in node.get("config", {}).items():
                config[str(key)] = str(value)
            rendered = self._loader.render_template(
                manifest,
                {
                    "node_name": node["name"],
                    "input_vars": input_vars,
                    "output_vars": output_vars,
                    "config": config,
                },
            )
            marker = _marker_for(node["name"], manifest, marker_inputs, output_vars)
            cell_sources.append(f"{marker}\n{rendered}")
        return PipelineDraft(
            notebook_path=notebook_path,
            cell_sources=cell_sources,
            nodes=nodes,
            edges=edges,
            backend=backend,
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_prompt(prompt: str, manifests: list[NodeManifest]) -> str:
    catalog_entries = []
    for manifest in manifests:
        entry = {
            "manifest_id": manifest.id,
            "name": manifest.name,
            "tag": manifest.tag,
            "description": manifest.description,
            "inputs": [p.name for p in manifest.inputs],
            "outputs": [p.name for p in manifest.outputs],
            "config_keys": [f.key for f in manifest.config_fields],
        }
        catalog_entries.append(entry)
    catalog_block = json.dumps(catalog_entries, indent=2)
    return (
        "Registry catalog (only these manifest ids are valid):\n\n"
        f"{catalog_block}\n\n"
        f"User request:\n{prompt.strip()}\n\n"
        "Draft the pipeline now."
    )


def _parse_and_validate(text: str, manifests: list[NodeManifest]) -> dict[str, Any]:
    cleaned = _strip_code_fences(text)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM JSON parse failed: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("Anthropic response is not a JSON object")

    valid_ids = {m.id for m in manifests}
    raw_nodes = payload.get("nodes")
    if not isinstance(raw_nodes, list):
        raise ValueError("Anthropic response missing 'nodes' list")

    seen_names: set[str] = set()
    nodes: list[dict[str, Any]] = []
    for raw in raw_nodes:
        if not isinstance(raw, dict):
            continue
        manifest_id = raw.get("manifest_id")
        if not isinstance(manifest_id, str) or manifest_id not in valid_ids:
            continue
        name = raw.get("name")
        if not isinstance(name, str) or name == "":
            continue
        # Dedup names so the marker grammar's node-name uniqueness holds.
        if name in seen_names:
            name = f"{name}_{len(seen_names)}"
        seen_names.add(name)
        config = raw.get("config", {})
        if not isinstance(config, dict):
            config = {}
        nodes.append(
            {
                "manifest_id": manifest_id,
                "name": name,
                "config": {str(k): str(v) for k, v in config.items()},
            },
        )

    raw_edges = payload.get("edges", [])
    edges: list[dict[str, str]] = []
    if isinstance(raw_edges, list):
        for raw in raw_edges:
            if not isinstance(raw, dict):
                continue
            src = raw.get("from")
            dst = raw.get("to")
            if isinstance(src, str) and isinstance(dst, str) and "." in src and "." in dst:
                edges.append({"from": src, "to": dst})
    return {"nodes": nodes, "edges": edges}


def _strip_code_fences(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        # Drop opening fence (with optional language tag) and matching close.
        stripped = re.sub(r"^```[a-zA-Z]*\n", "", stripped)
        if stripped.endswith("```"):
            stripped = stripped[: -len("```")]
    return stripped.strip()


def _keyword_pick(prompt: str, catalog: dict[str, NodeManifest]) -> list[str]:
    """Return up to 4 manifest ids whose keywords appear in the prompt."""
    haystack = prompt.lower()
    seen: set[str] = set()
    selected: list[str] = []
    for keyword, manifest_id in _KEYWORD_MAP:
        if manifest_id in seen or manifest_id not in catalog:
            continue
        if keyword in haystack:
            selected.append(manifest_id)
            seen.add(manifest_id)
        if len(selected) >= 4:
            break
    return selected


def _default_node_name(manifest: NodeManifest) -> str:
    """Strip non-alphanumeric chars and join camel-case so the name slots into
    the single-line ``# @node:`` marker without confusing the parser."""
    cleaned = re.sub(r"[^A-Za-z0-9 ]+", "", manifest.name)
    parts = [p for p in cleaned.split() if p]
    if not parts:
        return manifest.id.split(".")[-1] or "Node"
    return " ".join(parts)


def _heuristic_edges(
    nodes: list[dict[str, Any]],
    catalog: dict[str, NodeManifest],
) -> list[dict[str, str]]:
    edges: list[dict[str, str]] = []
    for upstream, downstream in zip(nodes, nodes[1:], strict=False):
        up_manifest = catalog[upstream["manifest_id"]]
        down_manifest = catalog[downstream["manifest_id"]]
        if not up_manifest.outputs or not down_manifest.inputs:
            continue
        src_port = up_manifest.outputs[0].name
        dst_port = down_manifest.inputs[0].name
        edges.append(
            {
                "from": f"{upstream['name']}.{src_port}",
                "to": f"{downstream['name']}.{dst_port}",
            },
        )
    return edges


def _marker_for(
    name: str,
    manifest: NodeManifest,
    input_vars: list[str],
    output_vars: list[str],
) -> str:
    parts = [f"# @node: {name}  [{manifest.tag}]"]
    if input_vars:
        parts.append(f"in={','.join(input_vars)}")
    if output_vars:
        parts.append(f"out={','.join(output_vars)}")
    return "  ".join(parts)
