"""Output nodes: send data somewhere terminal (charts, files, dashboards)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from notebookflow.protocol.manifest import (
    NodeConfigField,
    NodeConfigOption,
    NodeManifest,
    NodePort,
)

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
    template=(
        'plot_kwargs = {{"kind": {kind_literal}}}\n'
        'if {x_column_literal} != "":\n'
        '    plot_kwargs["x"] = {x_column_literal}\n'
        'if {y_column_literal} != "":\n'
        '    plot_kwargs["y"] = {y_column_literal}\n'
        'ax = {primary_input}.plot(**plot_kwargs)\n'
        'if {title_literal} != "":\n'
        '    ax.set_title({title_literal})\n'
    ),
    config_fields=[
        NodeConfigField(
            key="kind",
            label="Chart type",
            kind="select",
            description="Matplotlib/pandas chart kind.",
            required=True,
            default_value="line",
            options=[
                NodeConfigOption(value="line", label="Line"),
                NodeConfigOption(value="bar", label="Bar"),
                NodeConfigOption(value="scatter", label="Scatter"),
                NodeConfigOption(value="hist", label="Histogram"),
            ],
        ),
        NodeConfigField(
            key="x_column",
            label="X column",
            description="Optional column to use on the x-axis.",
            placeholder="date",
            default_value="",
        ),
        NodeConfigField(
            key="y_column",
            label="Y column",
            description="Optional column to use on the y-axis.",
            placeholder="sales",
            default_value="",
        ),
        NodeConfigField(
            key="title",
            label="Chart title",
            description="Optional chart title.",
            placeholder="Monthly sales",
            default_value="",
        ),
    ],
)


def register_all(registry: Registry) -> None:
    registry.register(PLOT_CHART)
