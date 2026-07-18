/**
 * Graph selection helpers — resolve canvas nodes from notebook cell positions.
 */

import type { GraphModel, NodeModel } from "@notebookflow/graph-canvas";

/**
 * Find the node in `groupId` (a notebook path) whose cell range covers
 * `cellIndex`, or null when the cell doesn't belong to any node.
 */
export function findNodeForCellIndex(
  graph: GraphModel,
  groupId: string,
  cellIndex: number,
): NodeModel | null {
  for (const node of Object.values(graph.nodes)) {
    if (node.groupId === groupId && node.cellIndices.includes(cellIndex)) {
      return node;
    }
  }
  return null;
}
