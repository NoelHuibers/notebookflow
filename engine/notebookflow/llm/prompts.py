"""Prompt library for the LLM feature modules.

First home for prompts that were previously inlined per module. For now it
holds only the NodeAuthor system prompt + its few-shot examples (the #19
"Create node" deliverable). The other nine inline ``_SYSTEM_PROMPT`` constants
across ``llm/`` are intentionally left in place -- migrating them is a separate
follow-up slice so this change stays reviewable.

Each entry is a module constant plus a small accessor so callers depend on the
function, not the raw string, and so few-shot examples can be assembled into the
system prompt in one place.
"""

from __future__ import annotations

# Allowed node tags mirror ``NodeManifest.NodeTag``. Duplicated as a plain tuple
# so the prompt text and the validator can share one source without importing
# pydantic here.
NODE_TAGS: tuple[str, ...] = ("input", "transform", "output", "ai", "io")

_NODE_AUTHOR_SYSTEM_PROMPT = """You author exactly one notebook node as JSON.

The user describes a single node in plain English. You are given the outputs of
the nodes already on the canvas (the "upstream context"). Design one node that
fulfils the request and wires itself to that upstream data.

Output ONLY a JSON object that matches this exact schema:

{{
  "name": "<short human-readable node name>",
  "tag": "<one of: {tags}>",
  "inputs": ["<local_var><-<UpstreamNodeName>.<port>", ...],
  "outputs": ["<python_identifier>", ...],
  "body": "<python cell source>"
}}

Rules:
- Each input is a binding string ``local<-Node.port``. The part after ``<-``
  (``Node.port``) MUST reference a node name and output port that appear in the
  upstream context -- never invent upstream nodes or ports. The part before
  ``<-`` is the Python variable that value is injected into inside the body.
- Only bind to upstream data the node actually needs; a source/input node may
  have no inputs at all (empty list).
- ``outputs`` are Python identifiers you assign in the body; the runtime
  captures them as this node's output ports.
- ``body`` is raw Python for one cell. Do NOT wrap it in Markdown fences, do NOT
  add a ``# @node`` marker line, and do NOT explain the code.
- Any bound input variable is already defined in the cell namespace. Assign
  every declared output variable before the cell ends.
- You may use the Python standard library plus pandas and matplotlib.
- Choose the tag that best fits: ``input`` (produces data), ``transform``
  (reshapes data), ``output`` (writes/plots), ``ai`` (LLM/ML), ``io`` (network).
"""

# Few-shot examples: (upstream-context summary, expected JSON). Kept small and
# deterministic so the model learns the binding grammar, not a specific domain.
_NODE_AUTHOR_FEW_SHOTS: tuple[tuple[str, str], ...] = (
    (
        'Upstream context: [{"node_name": "Load CSV", "output_ports": ["df"]}]\n'
        'Request: "keep only rows where revenue is above 1000"',
        '{"name": "Filter High Revenue", "tag": "transform", '
        '"inputs": ["df<-Load CSV.df"], "outputs": ["filtered"], '
        '"body": "filtered = df[df[\\"revenue\\"] > 1000]\\n"}',
    ),
    (
        "Upstream context: []\n"
        'Request: "load the sales spreadsheet sales.csv"',
        '{"name": "Load Sales", "tag": "input", "inputs": [], '
        '"outputs": ["df"], '
        '"body": "import pandas as pd\\n\\ndf = pd.read_csv(\\"sales.csv\\")\\n"}',
    ),
    (
        'Upstream context: [{"node_name": "Filter EU", "output_ports": ["rows"]}]\n'
        'Request: "plot a bar chart of revenue by region"',
        '{"name": "Plot Revenue", "tag": "output", '
        '"inputs": ["rows<-Filter EU.rows"], "outputs": ["chart"], '
        '"body": "import matplotlib.pyplot as plt\\n\\n'
        'chart = rows.groupby(\\"region\\")[\\"revenue\\"].sum().plot.bar()\\n"}',
    ),
)


def node_author_system_prompt() -> str:
    """The NodeAuthor system prompt with its few-shot examples appended.

    The examples are rendered as a compact ``Example N`` block so the model sees
    the exact input->JSON mapping it must reproduce.
    """
    base = _NODE_AUTHOR_SYSTEM_PROMPT.format(tags=", ".join(NODE_TAGS))
    example_blocks = [
        f"Example {index}:\n{context}\nJSON:\n{answer}"
        for index, (context, answer) in enumerate(_NODE_AUTHOR_FEW_SHOTS, start=1)
    ]
    return base + "\n\n" + "\n\n".join(example_blocks) + "\n"


def node_author_few_shots() -> tuple[tuple[str, str], ...]:
    """The raw (context, expected-JSON) few-shot pairs, for tests/preview."""
    return _NODE_AUTHOR_FEW_SHOTS
