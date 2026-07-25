/**
 * Pipeline assembly — fold the canvas graph + per-file cell sources into the
 * PipelineDef the engine runs.
 */

import type { GraphModel } from "@notebookflow/graph-canvas";
import type { NotebookCell } from "@notebookflow/graph-canvas/sync";

import type { NodeAuthorContext, PipelineDef } from "./types";

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

/**
 * Build the upstream context the engine's NodeAuthor needs to wire a new node:
 * every node currently on the canvas, by name, with its output port names.
 * Nodes with no outputs (nothing to bind to) are omitted; blank names are
 * skipped so the binding grammar's `Node.port` source stays resolvable.
 * `notebookName` is advisory prompt context (the active file).
 */
export function buildNodeAuthorContext(graph: GraphModel, notebookName = ""): NodeAuthorContext {
  const upstream = Object.values(graph.nodes)
    .filter((node) => node.name.trim() !== "" && node.outputs.length > 0)
    .map((node) => ({ nodeName: node.name, outputPorts: [...node.outputs] }));
  return notebookName !== "" ? { upstream, notebookName } : { upstream };
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
