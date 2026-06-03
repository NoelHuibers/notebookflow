"""Node manifest schema.

Mirrors ``node-library-spec/node_manifest.schema.json``. A pydantic model is
used at runtime so registry/loader code can rely on validated fields.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

NodeTag = Literal["input", "transform", "output", "ai", "io"]
NodeGenerationMode = Literal["template", "llm"]
NodeConfigFieldKind = Literal["text", "textarea", "select"]


class NodePort(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    name: str
    """Port identifier, used as the dict key on input/output payload maps."""

    type: str = "any"
    """Loose type tag — e.g. 'dataframe', 'json', 'text', 'fileref', 'any'."""

    required: bool = True


class NodeConfigOption(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    value: str
    label: str


class NodeConfigField(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    key: str = Field(..., pattern=r"^[a-z][a-z0-9_]*$")
    label: str
    kind: NodeConfigFieldKind = "text"
    description: str = ""
    placeholder: str = ""
    required: bool = False
    default_value: str = ""
    options: list[NodeConfigOption] = Field(default_factory=list)


class NodeManifest(BaseModel):
    """Public extension manifest contract."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

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
    generation_mode: NodeGenerationMode = "template"
    config_fields: list[NodeConfigField] = Field(default_factory=list)
