"""notebookflow-node-hello — minimal third-party node package.

This package is the reference implementation of the extension protocol
described in ``node-library-spec/CONTRIBUTING.md``. After ``pip install``
it, the NotebookFlow engine's ``Registry.discover()`` picks it up via the
``notebookflow.nodes`` entry point declared in this package's
``pyproject.toml`` and exposes a ``community.hello`` node on the canvas.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING

from notebookflow.protocol.manifest import NodeManifest

if TYPE_CHECKING:
    from notebookflow.protocol.registry import Registry

_MANIFEST_PATH = Path(__file__).parent / "node_manifest.json"


def load_manifest() -> NodeManifest:
    """Read the on-disk manifest and validate it through the pydantic model."""
    data = json.loads(_MANIFEST_PATH.read_text(encoding="utf-8"))
    return NodeManifest(**data)


def register(registry: Registry) -> None:
    """Entry point invoked by ``notebookflow.protocol.registry.Registry.discover()``."""
    registry.register(load_manifest())
