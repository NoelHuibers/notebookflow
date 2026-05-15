"""Output nodes: send data somewhere terminal (charts, files, dashboards)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from notebookflow.protocol.manifest import NodeManifest, NodePort

if TYPE_CHECKING:
    from notebookflow.protocol.registry import Registry


PLOT_CHART = NodeManifest(
    id="notebookflow.plot_chart",
    name="Plot Chart",
    tag="output",
    version="0.1.0",
    description="Render a quick exploratory chart from a DataFrame.",
    inputs=[NodePort(name="df", type="dataframe")],
    outputs=[],
    template="df.plot()\n",
)


def register_all(registry: Registry) -> None:
    registry.register(PLOT_CHART)
