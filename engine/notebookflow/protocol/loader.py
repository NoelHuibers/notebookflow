"""Loader — instantiates a node implementation from a manifest id.

Resolves ``manifest.id`` → callable that the executor can invoke. Supports
both Python-callable nodes (resolved via importlib) and code-template nodes
whose body is rendered into a notebook cell at insertion time.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from notebookflow.protocol.manifest import NodeManifest
from notebookflow.protocol.registry import Registry


class Loader:
    def __init__(self, registry: Registry) -> None:
        self._registry = registry

    def load_callable(self, _manifest_id: str) -> Callable[..., Any]:
        # TODO: resolve "package.module:func" reference declared by the node.
        raise NotImplementedError

    def render_template(self, manifest: NodeManifest, params: dict[str, Any]) -> str:
        input_vars = _string_list(params.get("input_vars"))
        output_vars = _string_list(params.get("output_vars"))
        config = _string_dict(params.get("config"))

        primary_input = input_vars[0] if input_vars else _first_port_name(manifest.inputs, "value")
        primary_output = (
            output_vars[0] if output_vars else _first_port_name(manifest.outputs, "result")
        )

        context: dict[str, Any] = {
            "node_name": str(params.get("node_name") or manifest.name),
            "manifest_id": manifest.id,
            "primary_input": primary_input,
            "primary_output": primary_output,
            "input_count": len(input_vars),
            "output_count": len(output_vars),
        }
        for key, value in config.items():
            context[key] = value
            context[f"{key}_literal"] = json.dumps(value)

        try:
            rendered = manifest.template.format_map(context)
        except KeyError as exc:
            missing = exc.args[0]
            raise ValueError(
                f"Manifest {manifest.id!r} references unknown template variable {missing!r}"
            ) from exc

        return rendered if rendered.endswith("\n") else f"{rendered}\n"


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        if isinstance(item, str) and item != "":
            result.append(item)
    return result


def _string_dict(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, str] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            continue
        if isinstance(item, str):
            result[key] = item
        elif item is None:
            result[key] = ""
        else:
            result[key] = str(item)
    return result


def _first_port_name(ports: list[Any], fallback: str) -> str:
    port = ports[0] if ports else None
    name = getattr(port, "name", "")
    return name if isinstance(name, str) and name != "" else fallback
