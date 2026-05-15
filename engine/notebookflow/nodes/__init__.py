"""Built-in node library.

Nodes are grouped by tag — input / transform / output / ai / io. Each
submodule registers its nodes with the protocol registry; the ``register``
function below is the entry point declared in ``pyproject.toml`` under
``[project.entry-points."notebookflow.nodes"]``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from notebookflow.nodes import input as input_nodes
from notebookflow.nodes import output as output_nodes
from notebookflow.nodes import transform as transform_nodes

if TYPE_CHECKING:
    from notebookflow.protocol.registry import Registry


def register(registry: Registry) -> None:
    """Register all built-in nodes with the given Registry."""
    input_nodes.register_all(registry)
    transform_nodes.register_all(registry)
    output_nodes.register_all(registry)
