import { describe, expect, it } from "vitest";
import type { Node } from "reactflow";

import type { NodeModel } from "../types";
import {
  applyMeasuredGroupLayout,
  countSidePortRows,
  estimateNodeHeight,
  estimateNodeWidth,
  horizontalCellX,
  NODE_GAP,
} from "./nodeLayout";
import { NODE_GROUP_HEADER_HEIGHT } from "./NodeGroup";

const GROUP_LAYOUT = {
  columnWidth: 320,
  nodeXInset: 16,
  groupInnerTopPadding: 16,
  groupInnerBottomPadding: 24,
  groupInnerRightPadding: 16,
  groupHeaderHeight: NODE_GROUP_HEADER_HEIGHT,
  collapsedGroupHeight: NODE_GROUP_HEADER_HEIGHT,
  nodeGap: NODE_GAP,
} as const;

function notebookNode(id: string, cellIndex: number, parentNode: string): Node {
  return {
    id,
    type: "notebook",
    parentNode,
    position: { x: 0, y: 0 },
    data: { id, cellIndices: [cellIndex] },
  };
}

function groupNode(id: string): Node {
  return {
    id,
    type: "group",
    position: { x: 0, y: 0 },
    data: { collapsed: false },
    style: { width: 320, height: 200 },
  };
}

const transformNode: NodeModel = {
  id: "n1",
  groupId: "g1",
  name: "Transform",
  tag: "transform",
  cellIndices: [0],
  inputs: ["Load.df"],
  outputs: ["clean"],
};

describe("nodeLayout", () => {
  it("grows side height with port rows", () => {
    const oneRow = estimateNodeHeight(transformNode, "sides");
    const threeRows = estimateNodeHeight(
      { ...transformNode, inputs: ["a", "b", "c"] },
      "sides",
    );
    expect(threeRows).toBeGreaterThan(oneRow);
  });

  it("adds height for meta and editable drop rows", () => {
    const base = estimateNodeHeight(transformNode, "sides");
    const withMeta = estimateNodeHeight(transformNode, "sides", { hasMeta: true });
    const editable = estimateNodeHeight({ ...transformNode, inputs: [] }, "sides", {
      portsEditable: true,
    });
    expect(withMeta).toBeGreaterThan(base);
    expect(editable).toBeGreaterThanOrEqual(base);
    expect(countSidePortRows({ ...transformNode, inputs: [] }, true)).toBe(2);
  });

  it("estimates stacked width from port columns", () => {
    const narrow = estimateNodeWidth(transformNode, "stacked");
    const wide = estimateNodeWidth(
      { ...transformNode, inputs: ["a", "b", "c", "d"] },
      "stacked",
      { portsEditable: true },
    );
    expect(wide).toBeGreaterThan(narrow);
  });

  it("spaces horizontal cells by width plus uniform gap", () => {
    const widths = [200, 240, 180];
    expect(horizontalCellX([])).toBe(16);
    expect(horizontalCellX([widths[0]!])).toBe(16 + 200 + NODE_GAP);
    expect(horizontalCellX(widths.slice(0, 2))).toBe(16 + 200 + NODE_GAP + 240 + NODE_GAP);
  });

  it("positions vertical stack from measured heights with uniform gap", () => {
    const groupId = "group:g1";
    const nodes = [
      groupNode(groupId),
      notebookNode("a", 0, groupId),
      notebookNode("b", 1, groupId),
    ];
    const measured = new Map([
      ["a", { width: 220, height: 120 }],
      ["b", { width: 220, height: 90 }],
    ]);
    const fallback = (): { width: number; height: number } => ({ width: 200, height: 100 });
    const laidOut = applyMeasuredGroupLayout(nodes, measured, false, GROUP_LAYOUT, fallback);

    const a = laidOut.find((node) => node.id === "a");
    const b = laidOut.find((node) => node.id === "b");
    const group = laidOut.find((node) => node.id === groupId);

    expect(a?.position).toEqual({
      x: 16,
      y: NODE_GROUP_HEADER_HEIGHT + 16,
    });
    expect(b?.position).toEqual({
      x: 16,
      y: NODE_GROUP_HEADER_HEIGHT + 16 + 120 + NODE_GAP,
    });
    expect((group?.style as { height?: number })?.height).toBe(
      NODE_GROUP_HEADER_HEIGHT + 16 + 120 + NODE_GAP + 90 + 24,
    );
  });

  it("grows stacked group width from the widest measured cell", () => {
    const groupId = "group:g1";
    const nodes = [groupNode(groupId), notebookNode("a", 0, groupId)];
    const measured = new Map([["a", { width: 380, height: 120 }]]);
    const fallback = (): { width: number; height: number } => ({ width: 200, height: 100 });
    const laidOut = applyMeasuredGroupLayout(nodes, measured, false, GROUP_LAYOUT, fallback);
    const group = laidOut.find((node) => node.id === groupId);

    expect((group?.style as { width?: number })?.width).toBe(16 + 380 + 16);
  });

  it("positions horizontal row from measured widths with uniform gap", () => {
    const groupId = "group:g1";
    const nodes = [
      groupNode(groupId),
      notebookNode("a", 0, groupId),
      notebookNode("b", 1, groupId),
    ];
    const measured = new Map([
      ["a", { width: 180, height: 140 }],
      ["b", { width: 220, height: 110 }],
    ]);
    const fallback = (): { width: number; height: number } => ({ width: 200, height: 100 });
    const laidOut = applyMeasuredGroupLayout(nodes, measured, true, GROUP_LAYOUT, fallback);

    const a = laidOut.find((node) => node.id === "a");
    const b = laidOut.find((node) => node.id === "b");
    const group = laidOut.find((node) => node.id === groupId);

    expect(a?.position).toEqual({
      x: 16,
      y: NODE_GROUP_HEADER_HEIGHT + 16,
    });
    expect(b?.position).toEqual({
      x: 16 + 180 + NODE_GAP,
      y: NODE_GROUP_HEADER_HEIGHT + 16,
    });
    expect((group?.style as { width?: number })?.width).toBe(16 + 180 + NODE_GAP + 220 + 16);
    expect((group?.style as { height?: number })?.height).toBe(
      NODE_GROUP_HEADER_HEIGHT + 16 + 140 + 24,
    );
  });
});
