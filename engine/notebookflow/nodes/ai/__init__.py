"""AI-assisted nodes that synthesize or explain notebook code."""

from __future__ import annotations

from typing import TYPE_CHECKING

from notebookflow.protocol.manifest import NodeConfigField, NodeManifest, NodePort

if TYPE_CHECKING:
    from notebookflow.protocol.registry import Registry


AI_PYTHON_TRANSFORM = NodeManifest(
    id="notebookflow.ai_python_transform",
    name="AI Python Transform",
    tag="ai",
    version="0.1.0",
    description=(
        "Use OpenAI to draft a Python transformation cell from a natural-language instruction."
    ),
    inputs=[NodePort(name="df", type="dataframe", required=False)],
    outputs=[NodePort(name="result", type="any")],
    template=(
        "# TODO: configure OPENAI_API_KEY or NOTEBOOKFLOW_OPENAI_API_KEY in .env or the\n"
        "# shell to enable AI synthesis.\n"
        "# Instruction: {instruction}\n"
        "{primary_output} = None\n"
    ),
    generation_mode="llm",
    config_fields=[
        NodeConfigField(
            key="instruction",
            label="Instruction",
            kind="textarea",
            description="Describe the transformation that should be implemented in this node.",
            placeholder="Compute the mean revenue per country and sort descending.",
            required=True,
            default_value="Describe the transformation you want here.",
        )
    ],
)


def register_all(registry: Registry) -> None:
    registry.register(AI_PYTHON_TRANSFORM)
