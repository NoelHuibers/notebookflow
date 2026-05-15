"""Registry — discovers and indexes all available node manifests.

Built-in nodes are registered via the ``notebookflow.nodes`` entry point
declared in ``engine/pyproject.toml``. Third-party packages declare the same
entry point in their own pyproject. ``discover()`` walks the entry-point
group on startup and gives every registered package a chance to populate
this registry.

ID-conflict policy: ``register`` raises ``ValueError`` if a manifest with
the same ``id`` is already present, regardless of version. Packages own
their ids; collisions are programmer errors, not version-management
concerns.
"""

from __future__ import annotations

import importlib.metadata
from collections.abc import Iterator

from notebookflow.protocol.manifest import NodeManifest


class Registry:
    def __init__(self) -> None:
        self._manifests: dict[str, NodeManifest] = {}

    def register(self, manifest: NodeManifest) -> None:
        if manifest.id in self._manifests:
            existing = self._manifests[manifest.id]
            raise ValueError(
                f"Node id {manifest.id!r} already registered "
                f"(existing v{existing.version}, new v{manifest.version})"
            )
        self._manifests[manifest.id] = manifest

    def get(self, manifest_id: str) -> NodeManifest:
        if manifest_id not in self._manifests:
            raise KeyError(manifest_id)
        return self._manifests[manifest_id]

    def all(self) -> Iterator[NodeManifest]:
        return iter(self._manifests.values())

    @classmethod
    def discover(cls) -> Registry:
        """Walk the ``notebookflow.nodes`` entry-point group and invoke each one.

        Each entry point is expected to be a callable ``register(registry)``
        that calls back into ``registry.register(...)`` for every manifest it
        contributes. The returned registry is the union of every contribution.
        """
        registry = cls()
        for entry_point in importlib.metadata.entry_points(group="notebookflow.nodes"):
            register_func = entry_point.load()
            register_func(registry)
        return registry
