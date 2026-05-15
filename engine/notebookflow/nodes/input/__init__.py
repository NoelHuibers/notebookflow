"""Input nodes: produce data from external sources (CSV, Parquet, HTTP, etc.)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from notebookflow.protocol.manifest import NodeManifest, NodePort

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
    template="import pandas as pd\ndf = pd.read_csv('data.csv')\n",
)


def register_all(registry: Registry) -> None:
    registry.register(PARSE_CSV)
