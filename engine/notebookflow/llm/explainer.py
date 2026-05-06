"""Explainer — graph → literate prose description of the pipeline.

Used in the canvas sidebar and in generated docs: walks the DAG in
topological order and asks an LLM to produce a paragraph-per-section
overview of what the pipeline does.
"""

from __future__ import annotations

from notebookflow.core.dag import DAG


class Explainer:
    async def explain(self, _dag: DAG) -> str:
        # TODO: serialize DAG (node names, tags, wires) into a prompt;
        #   ask LLM for a structured prose explanation.
        raise NotImplementedError
