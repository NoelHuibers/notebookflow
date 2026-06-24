/**
 * Pipeline assembly — fold the canvas graph + per-file cell sources into the
 * PipelineDef the engine runs.
 */

import type { GraphModel } from "@notebookflow/graph-canvas";
import type { NotebookCell } from "@notebookflow/graph-canvas/sync";

import type { PipelineDef } from "./EngineClient";

export function buildPipelineDef(
  graph: GraphModel,
  cellsByPath: Map<string, NotebookCell[]>,
): PipelineDef {
  const nodes = Object.values(graph.nodes).map((node) => {
    // Each node's source + alias come from its own notebook (group), so a
    // workspace spanning several files composes into one pipeline.
    const group = graph.groups[node.groupId];
    const notebookPath = group?.notebookPath ?? node.groupId;
    const alias = group?.alias ?? "";
    const cells = cellsByPath.get(notebookPath) ?? [];
    const cellIndex = node.cellIndices[0] ?? 0;
    const source = cells[cellIndex]?.source ?? "";
    return {
      id: node.id,
      name: node.name,
      tag: node.tag,
      inputs: node.inputs,
      outputs: node.outputs,
      source: stripMarkerLine(source),
      notebookPath,
      cellIndices: node.cellIndices,
      alias,
    };
  });
  const edges = Object.values(graph.wires).map((wire) => ({
    sourceNodeId: wire.sourceNodeId,
    sourcePort: wire.sourcePort,
    targetNodeId: wire.targetNodeId,
    targetPort: wire.targetPort,
  }));
  return { nodes, edges };
}

export function stripMarkerLine(source: string): string {
  const newline = source.indexOf("\n");
  if (newline === -1) {
    return "";
  }
  const firstLine = source.slice(0, newline).trim();
  if (firstLine.startsWith("# @node:")) {
    return source.slice(newline + 1);
  }
  return source;
}
