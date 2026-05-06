"""LLM-assisted authoring.

Three roles:
    * ``pipeline_author`` — natural-language description → full pipeline graph.
    * ``code_synth``      — manifest + intent → code body for a single node.
    * ``explainer``       — graph → literate prose description of the pipeline.
"""

from notebookflow.llm.code_synth import CodeSynth
from notebookflow.llm.explainer import Explainer
from notebookflow.llm.pipeline_author import PipelineAuthor

__all__ = ["CodeSynth", "Explainer", "PipelineAuthor"]
