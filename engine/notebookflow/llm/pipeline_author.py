"""PipelineAuthor — natural-language description → full pipeline graph.

Given a user prompt and the current node registry, asks an LLM to propose a
graph (nodes + wires) using only manifests that exist. Returns a draft the
SyncEngine can apply (which in turn injects markers into a fresh notebook).
"""

from __future__ import annotations

from dataclasses import dataclass

from notebookflow.protocol.registry import Registry


@dataclass(slots=True)
class PipelineDraft:
    notebook_path: str
    cell_sources: list[str]


class PipelineAuthor:
    def __init__(self, registry: Registry) -> None:
        self._registry = registry

    async def propose(self, _prompt: str) -> PipelineDraft:
        # TODO: build registry summary, call LLM with structured-output
        #   schema constrained to known manifest ids.
        raise NotImplementedError
