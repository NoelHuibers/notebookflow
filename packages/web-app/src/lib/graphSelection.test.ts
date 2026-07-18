import type { GraphModel, NodeModel } from "@notebookflow/graph-canvas";
import { describe, expect, it } from "vitest";

import { findNodeForCellIndex } from "./graphSelection";

function node(id: string, groupId: string, cellIndices: number[]): NodeModel {
  return {
    id,
    name: id,
    tag: "transform",
    inputs: [],
    outputs: [],
    cellIndices,
    groupId,
  };
}

function graphWith(nodes: NodeModel[]): GraphModel {
  return {
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    groups: {},
    wires: {},
  };
}

describe("findNodeForCellIndex", () => {
  it("returns the node in the group whose cell range covers the index", () => {
    const graph = graphWith([node("clean", "a.ipynb", [0, 1]), node("plot", "a.ipynb", [2])]);

    expect(findNodeForCellIndex(graph, "a.ipynb", 1)?.id).toBe("clean");
    expect(findNodeForCellIndex(graph, "a.ipynb", 2)?.id).toBe("plot");
  });

  it("returns null when no node in the group covers the index", () => {
    const graph = graphWith([node("clean", "a.ipynb", [0])]);

    expect(findNodeForCellIndex(graph, "a.ipynb", 3)).toBeNull();
  });

  it("ignores nodes with the same cell index in another notebook", () => {
    const graph = graphWith([node("other", "b.ipynb", [0])]);

    expect(findNodeForCellIndex(graph, "a.ipynb", 0)).toBeNull();
  });
});
