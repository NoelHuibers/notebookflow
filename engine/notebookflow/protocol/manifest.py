"""Node manifest schema.

Mirrors ``node-library-spec/node_manifest.schema.json``. A pydantic model is
used at runtime so registry/loader code can rely on validated fields.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

NodeTag = Literal["input", "transform", "output", "ai", "io"]


class NodePort(BaseModel):
    name: str
    """Port identifier, used as the dict key on input/output payload maps."""

    type: str = "any"
    """Loose type tag — e.g. 'dataframe', 'json', 'text', 'fileref', 'any'."""

    required: bool = True


class NodeManifest(BaseModel):
    """Public extension manifest contract."""

    id: str = Field(..., description="Globally unique node id, e.g. notebookflow.parse_csv")
    name: str
    tag: NodeTag
    inputs: list[NodePort] = Field(default_factory=list)
    outputs: list[NodePort] = Field(default_factory=list)
    template: str = Field(
        "",
        description="Cell-source template inserted when the node is added to a notebook.",
    )
    version: str = "0.0.0"
    description: str = ""
