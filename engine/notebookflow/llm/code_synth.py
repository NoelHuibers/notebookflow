"""CodeSynth — generate the body of a single node from its manifest + intent.

Used when the user adds a custom node to the canvas: given the declared
inputs, outputs, and a short description, the LLM writes the cell source
that satisfies the manifest contract.
"""

from __future__ import annotations

from notebookflow.protocol.manifest import NodeManifest


class CodeSynth:
    async def synthesize(self, _manifest: NodeManifest, _intent: str) -> str:
        # TODO: prompt the LLM with manifest + intent; return cell source string.
        raise NotImplementedError
