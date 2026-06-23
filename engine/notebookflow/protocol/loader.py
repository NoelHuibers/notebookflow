"""Loader — instantiates a node implementation from a manifest id.

Resolves ``manifest.id`` → callable that the executor can invoke. Supports
both Python-callable nodes (resolved via importlib) and code-template nodes
whose body is rendered into a notebook cell at insertion time.
"""

from __future__ import annotations

import importlib
import json
from collections.abc import Callable
from typing import Any

from notebookflow.protocol.manifest import NodeManifest
from notebookflow.protocol.registry import Registry


class Loader:
    def __init__(self, registry: Registry) -> None:
        self._registry = registry

    def load_callable(self, manifest_id: str) -> Callable[..., Any]:
        """Resolve a registered manifest id to its Python callable.

        The id doubles as the import reference. Two forms are accepted:
          - ``"package.module:attr"`` — entry-point style (colon-separated)
          - ``"package.module.attr"`` — last dot splits module from attribute

        Raises:
          KeyError: no manifest registered with that id.
          ValueError: id cannot be parsed, or module/attribute does not exist.
          TypeError: the resolved attribute is not callable.
        """
        # Surface unknown manifests up-front so callers don't need to
        # combine Registry.get + load_callable themselves.
        self._registry.get(manifest_id)

        module_path, attr = _split_reference(manifest_id)
        try:
            module = importlib.import_module(module_path)
        except ImportError as exc:
            raise ValueError(
                f"Cannot import module {module_path!r} for manifest "
                f"{manifest_id!r}: {exc}"
            ) from exc

        try:
            target = getattr(module, attr)
        except AttributeError as exc:
            raise ValueError(
                f"Module {module_path!r} has no attribute {attr!r} "
                f"(manifest {manifest_id!r})"
            ) from exc

        if not callable(target):
            raise TypeError(
                f"Manifest {manifest_id!r} resolves to "
                f"{type(target).__name__!r}, not a callable"
            )
        return target

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
            "primary_input_literal": json.dumps(primary_input),
            "primary_output": primary_output,
            "primary_output_literal": json.dumps(primary_output),
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


def _split_reference(reference: str) -> tuple[str, str]:
    """Split a "module:attr" or "module.attr" callable reference."""
    if ":" in reference:
        module_path, _, attr = reference.partition(":")
        if module_path == "" or attr == "":
            raise ValueError(
                f"Invalid callable reference {reference!r} (expected 'module:attr')",
            )
        return module_path, attr
    if "." not in reference:
        raise ValueError(
            f"Invalid callable reference {reference!r} "
            "(expected 'module.attr' or 'module:attr')",
        )
    module_path, _, attr = reference.rpartition(".")
    return module_path, attr
