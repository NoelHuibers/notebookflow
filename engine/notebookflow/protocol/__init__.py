"""Extension protocol: manifest schema, registry, dynamic loader.

Third-party node packages declare a ``node_manifest.json`` and register a
Python entry point under ``notebookflow.nodes``. The Registry discovers them
on startup; the Loader instantiates nodes on demand.
"""

from notebookflow.protocol.loader import Loader
from notebookflow.protocol.manifest import NodeManifest
from notebookflow.protocol.registry import Registry

__all__ = ["Loader", "NodeManifest", "Registry"]
