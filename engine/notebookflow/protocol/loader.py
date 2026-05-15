"""Loader — instantiates a node implementation from a manifest id.

Resolves ``manifest.id`` → callable that the executor can invoke. Supports
both Python-callable nodes (resolved via importlib) and code-template nodes
whose body is rendered into a notebook cell at insertion time.
"""

from __future__ import annotations

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

    def render_template(self, _manifest: NodeManifest, _params: dict[str, Any]) -> str:
        # TODO: substitute params into manifest.template, return cell source.
        raise NotImplementedError
