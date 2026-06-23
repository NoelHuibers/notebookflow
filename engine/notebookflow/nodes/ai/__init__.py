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


LLM_GENERATE = NodeManifest(
    id="notebookflow.llm_generate",
    name="LLM Generate",
    tag="ai",
    version="0.1.0",
    description="Call an Anthropic chat model with a prompt and capture the text response.",
    inputs=[NodePort(name="prompt", type="text", required=False)],
    outputs=[NodePort(name="text", type="text")],
    template=(
        "import os\n"
        "import anthropic\n"
        "\n"
        "client = anthropic.Anthropic(api_key=os.environ.get('ANTHROPIC_API_KEY'))\n"
        "_prompt = locals().get({primary_input_literal}) or {prompt_literal}\n"
        "_response = client.messages.create(\n"
        "    model={model_literal},\n"
        "    max_tokens=int({max_tokens_literal}),\n"
        "    messages=[{{'role': 'user', 'content': _prompt}}],\n"
        ")\n"
        "{primary_output} = ''.join(\n"
        "    block.text for block in _response.content if hasattr(block, 'text')\n"
        ")\n"
    ),
    config_fields=[
        NodeConfigField(
            key="model",
            label="Model",
            description="Anthropic model id (claude-sonnet-4-6, claude-opus-4-7, …).",
            placeholder="claude-sonnet-4-6",
            required=True,
            default_value="claude-sonnet-4-6",
        ),
        NodeConfigField(
            key="prompt",
            label="Default prompt",
            kind="textarea",
            description=(
                "Used when no upstream `prompt` input is wired. Upstream input wins."
            ),
            placeholder="Summarise the latest quarterly revenue trends.",
            required=False,
            default_value="Hello, Claude. Briefly introduce yourself.",
        ),
        NodeConfigField(
            key="max_tokens",
            label="Max tokens",
            description="Upper bound on the assistant's response length.",
            placeholder="512",
            required=True,
            default_value="512",
        ),
    ],
)


EMBED = NodeManifest(
    id="notebookflow.embed",
    name="Embed Text",
    tag="ai",
    version="0.1.0",
    description=(
        "Compute embedding vectors for one or more strings using a configurable provider."
    ),
    inputs=[NodePort(name="texts", type="json", required=False)],
    outputs=[NodePort(name="vectors", type="json")],
    template=(
        "import os\n"
        "from openai import OpenAI\n"
        "\n"
        "client = OpenAI(api_key=os.environ.get('OPENAI_API_KEY'))\n"
        "_inputs = locals().get({primary_input_literal})\n"
        "if _inputs is None:\n"
        "    _inputs = [{seed_text_literal}]\n"
        "elif isinstance(_inputs, str):\n"
        "    _inputs = [_inputs]\n"
        "_response = client.embeddings.create(\n"
        "    model={model_literal},\n"
        "    input=list(_inputs),\n"
        ")\n"
        "{primary_output} = [item.embedding for item in _response.data]\n"
    ),
    config_fields=[
        NodeConfigField(
            key="model",
            label="Model",
            description="Embedding model. OpenAI's text-embedding-3-small is the cheap default.",
            placeholder="text-embedding-3-small",
            required=True,
            default_value="text-embedding-3-small",
        ),
        NodeConfigField(
            key="seed_text",
            label="Seed text",
            description=(
                "Used as the input when no upstream `texts` is wired. Upstream input wins."
            ),
            placeholder="NotebookFlow turns notebooks into pipelines.",
            required=False,
            default_value="NotebookFlow turns notebooks into pipelines.",
        ),
    ],
)


CLASSIFY = NodeManifest(
    id="notebookflow.classify",
    name="Classify Rows",
    tag="ai",
    version="0.1.0",
    description=(
        "Label each row of a DataFrame with one of the provided categories via an LLM."
    ),
    inputs=[NodePort(name="df", type="dataframe")],
    outputs=[NodePort(name="df", type="dataframe")],
    template=(
        "import os\n"
        "import anthropic\n"
        "\n"
        "client = anthropic.Anthropic(api_key=os.environ.get('ANTHROPIC_API_KEY'))\n"
        "_labels = [s.strip() for s in {labels_literal}.split(',') if s.strip()]\n"
        "_text_col = {text_column_literal}\n"
        "_label_col = {label_column_literal}\n"
        "_model = {model_literal}\n"
        "\n"
        "def _classify(text):\n"
        "    msg = client.messages.create(\n"
        "        model=_model,\n"
        "        max_tokens=8,\n"
        "        messages=[\n"
        "            {{\n"
        "                'role': 'user',\n"
        "                'content': (\n"
        "                    'Classify the text into exactly one of: ' + ', '.join(_labels)\n"
        "                    + '. Reply with only the label.\\n\\nText: ' + str(text)\n"
        "                ),\n"
        "            }}\n"
        "        ],\n"
        "    )\n"
        "    reply = ''.join(b.text for b in msg.content if hasattr(b, 'text')).strip()\n"
        "    return reply if reply in _labels else _labels[0]\n"
        "\n"
        "{primary_output} = {primary_input}.assign(\n"
        "    **{{_label_col: {primary_input}[_text_col].map(_classify)}}\n"
        ")\n"
    ),
    config_fields=[
        NodeConfigField(
            key="model",
            label="Model",
            description="Anthropic model id used for classification.",
            placeholder="claude-haiku-4-5-20251001",
            required=True,
            default_value="claude-haiku-4-5-20251001",
        ),
        NodeConfigField(
            key="text_column",
            label="Text column",
            description="Column on the input DataFrame whose values are classified.",
            placeholder="comment",
            required=True,
            default_value="text",
        ),
        NodeConfigField(
            key="label_column",
            label="Label column",
            description="Name of the new column receiving the chosen label per row.",
            placeholder="label",
            required=True,
            default_value="label",
        ),
        NodeConfigField(
            key="labels",
            label="Allowed labels",
            description="Comma-separated set of labels the model picks from.",
            placeholder="positive, neutral, negative",
            required=True,
            default_value="positive, neutral, negative",
        ),
    ],
)


def register_all(registry: Registry) -> None:
    registry.register(AI_PYTHON_TRANSFORM)
    registry.register(LLM_GENERATE)
    registry.register(EMBED)
    registry.register(CLASSIFY)
