"""Registry — discovers and indexes all available node manifests.

Built-in nodes are registered via the ``notebookflow.nodes`` entry point
declared in ``engine/pyproject.toml``. Third-party packages declare the same
entry point in their own pyproject. ``discover()`` walks the entry-point
group on startup and gives every registered package a chance to populate
this registry.
"""

from __future__ import annotations

from typing import Iterator

from notebookflow.protocol.manifest import NodeManifest


class Registry:
    def __init__(self) -> None:
        self._manifests: dict[str, NodeManifest] = {}

    def register(self, _manifest: NodeManifest) -> None:
        # TODO: store, reject id conflicts (or version-tag them).
        raise NotImplementedError

    def get(self, _id: str) -> NodeManifest:
        # TODO: return manifest or raise KeyError.
        raise NotImplementedError

    def all(self) -> Iterator[NodeManifest]:
        # TODO: iterate registered manifests.
        raise NotImplementedError

    @classmethod
    def discover(cls) -> "Registry":
        # TODO: importlib.metadata.entry_points(group="notebookflow.nodes"),
        #   call each one with the registry instance.
        raise NotImplementedError
