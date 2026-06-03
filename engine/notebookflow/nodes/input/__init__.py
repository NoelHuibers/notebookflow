"""Input nodes: produce data from external sources (CSV, Parquet, HTTP, etc.)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from notebookflow.protocol.manifest import NodeConfigField, NodeManifest, NodePort

if TYPE_CHECKING:
    from notebookflow.protocol.registry import Registry


PARSE_CSV = NodeManifest(
    id="notebookflow.parse_csv",
    name="Parse CSV",
    tag="input",
    version="0.1.0",
    description="Read a CSV file from disk into a pandas DataFrame.",
    inputs=[],
    outputs=[NodePort(name="df", type="dataframe")],
    template='import pandas as pd\n{primary_output} = pd.read_csv({path_literal})\n',
    config_fields=[
        NodeConfigField(
            key="path",
            label="CSV filename",
            description="Path to the CSV file that should be loaded.",
            placeholder="data.csv",
            required=True,
            default_value="data.csv",
        )
    ],
)


def register_all(registry: Registry) -> None:
    registry.register(PARSE_CSV)
