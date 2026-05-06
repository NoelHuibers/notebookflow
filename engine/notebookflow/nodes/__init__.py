"""Built-in node library.

Nodes are grouped by tag — input / transform / output / ai / io. Each
submodule registers its nodes with the protocol registry; the ``register``
function below is the entry point declared in ``pyproject.toml`` under
``[project.entry-points."notebookflow.nodes"]``.
"""

from notebookflow.protocol.registry import Registry


def register(_registry: Registry) -> None:
    """Register all built-in nodes with the given Registry."""
    # TODO: import each subpackage (input, transform, output, ai, io)
    #   and call its register_all(registry).
    raise NotImplementedError
