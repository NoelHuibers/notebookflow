/**
 * Node layout helpers — estimates for the first paint, measured sizes for
 * final group positioning after React Flow renders each node.
 */

import type { Node } from "reactflow";

import type { NodeModel } from "../types";
import type { PortPlacement } from "./InletOutletGrid";
import { STACKED_PORT_COLUMN_MIN, SIDES_PORT_LABEL_MIN } from "./portEditorShared";

export interface MeasuredSize {
  width: number;
  height: number;
}

export interface GroupLayoutConstants {
  columnWidth: number;
  nodeXInset: number;
  groupInnerTopPadding: number;
  groupInnerBottomPadding: number;
  groupInnerRightPadding: number;
  groupHeaderHeight: number;
  collapsedGroupHeight: number;
  nodeGap: number;
}

/** Gap between consecutive nodes inside a group (manual layout). */
export const NODE_GAP = 24;

/** @deprecated Use {@link NODE_GAP}. */
export const STACKED_NODE_GAP: number = NODE_GAP;

/** Legacy fixed slot — prefer {@link estimateNodeHeight}. */
export const SIDES_NODE_SLOT_HEIGHT = 160;

export interface NodeLayoutHints {
  /** Whether the host exposes port editors (add-row affordances). */
  portsEditable?: boolean;
  /** Whether the meta block (filename / rows / warnings) renders. */
  hasMeta?: boolean;
}

const STACKED_BODY_HEIGHT = 58;
const STACKED_PORT_BAND_HEIGHT = 58;

const SIDES_HEADER_HEIGHT = 34;
const SIDES_BODY_PADDING = 12;
const SIDES_PORT_HEADER = 20;
const SIDES_PORT_ROW = 26;
const SIDES_META_LINE = 16;
const SIDES_MIN_WIDTH = 200;
const SIDES_BODY_MIN_WIDTH = 120;
const SIDES_LABEL_COLUMN = SIDES_PORT_LABEL_MIN;

function showInlets(tag: NodeModel["tag"]): boolean {
  return tag !== "input";
}

function showOutlets(tag: NodeModel["tag"]): boolean {
  return tag !== "output";
}

/** Row count for the below-header Input | Output grid. */
export function countSidePortRows(node: NodeModel, portsEditable = false): number {
  const inlets = showInlets(node.tag);
  const outlets = showOutlets(node.tag);
  const inletRows = inlets ? node.inputs.length + (portsEditable ? 1 : 0) : 0;
  const outletRows = outlets ? node.outputs.length + (portsEditable ? 1 : 0) : 0;
  if (!inlets && !outlets) {
    return 0;
  }
  return Math.max(inletRows, outletRows, 1);
}

/** Column count for stacked top/bottom port rails. */
export function countStackedPortColumns(node: NodeModel, portsEditable = false): number {
  const inlets = showInlets(node.tag);
  const outlets = showOutlets(node.tag);
  const inletCols = inlets ? node.inputs.length + (portsEditable ? 1 : 0) : 0;
  const outletCols = outlets ? node.outputs.length + (portsEditable ? 1 : 0) : 0;
  return Math.max(inletCols, outletCols, 1);
}

export function estimateNodeHeight(
  node: NodeModel,
  portPlacement: PortPlacement,
  hints: NodeLayoutHints = {},
): number {
  const portsEditable = hints.portsEditable ?? false;
  const hasMeta = hints.hasMeta ?? false;

  if (portPlacement === "stacked") {
    let height = STACKED_BODY_HEIGHT;
    if (showInlets(node.tag)) {
      height += STACKED_PORT_BAND_HEIGHT;
    }
    if (showOutlets(node.tag)) {
      height += STACKED_PORT_BAND_HEIGHT;
    }
    return height;
  }

  let height = SIDES_HEADER_HEIGHT;
  const rows = countSidePortRows(node, portsEditable);

  if (hasMeta) {
    height += SIDES_META_LINE;
  }
  if (rows > 0) {
    height += SIDES_BODY_PADDING + SIDES_PORT_HEADER + rows * SIDES_PORT_ROW;
  } else if (hasMeta) {
    height += SIDES_BODY_PADDING;
  }

  return height;
}

export function estimateNodeWidth(
  node: NodeModel,
  portPlacement: PortPlacement,
  hints: NodeLayoutHints = {},
): number {
  const portsEditable = hints.portsEditable ?? false;

  if (portPlacement === "stacked") {
    const columns = countStackedPortColumns(node, portsEditable);
    return Math.max(220, columns * STACKED_PORT_COLUMN_MIN + 20);
  }

  const rows = countSidePortRows(node, portsEditable);
  if (rows === 0 && !showInlets(node.tag) && !showOutlets(node.tag)) {
    return SIDES_MIN_WIDTH;
  }

  let width = SIDES_BODY_MIN_WIDTH;
  if (showInlets(node.tag)) {
    width += SIDES_LABEL_COLUMN;
  }
  if (showOutlets(node.tag)) {
    width += SIDES_LABEL_COLUMN;
  }
  return Math.max(SIDES_MIN_WIDTH, width);
}

/** Cumulative X for the nth horizontal cell (0-based), given prior cell widths. */
export function horizontalCellX(
  priorWidths: number[],
  startInset: number = 16,
  gap: number = NODE_GAP,
): number {
  if (priorWidths.length === 0) {
    return startInset;
  }
  return priorWidths.reduce((x: number, width: number) => x + width + gap, startInset);
}

function cellSortKey(node: Node): number {
  const data = node.data as { cellIndices?: number[] };
  return data.cellIndices?.[0] ?? 0;
}

function isGroupCollapsed(group: Node): boolean {
  const data = group.data as { collapsed?: boolean };
  return data.collapsed === true;
}

/** Reposition notebook nodes and resize groups from measured DOM dimensions. */
export function applyMeasuredGroupLayout(
  nodes: Node[],
  measured: ReadonlyMap<string, MeasuredSize>,
  horizontalCells: boolean,
  constants: GroupLayoutConstants,
  fallbackSize: (node: Node) => MeasuredSize,
): Node[] {
  const groupNodes = nodes.filter((node) => node.type === "group");
  if (groupNodes.length === 0) {
    return nodes;
  }

  const childPositions = new Map<string, { x: number; y: number }>();
  const groupStyles = new Map<string, { width: number; height: number }>();

  for (const group of groupNodes) {
    const children = nodes
      .filter((node) => node.parentNode === group.id && node.type === "notebook")
      .sort((a, b) => cellSortKey(a) - cellSortKey(b));

    const sizes = children.map((child) => measured.get(child.id) ?? fallbackSize(child));
    const collapsed = isGroupCollapsed(group);

    let groupWidth = constants.columnWidth;
    let expandedHeight =
      constants.groupHeaderHeight +
      constants.groupInnerTopPadding +
      constants.groupInnerBottomPadding;

    if (horizontalCells) {
      let contentWidth = constants.nodeXInset;
      let maxCellHeight = 0;
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        const size = sizes[index];
        if (child === undefined || size === undefined) {
          continue;
        }
        if (!collapsed) {
          childPositions.set(child.id, {
            x: contentWidth,
            y: constants.groupHeaderHeight + constants.groupInnerTopPadding,
          });
        }
        contentWidth += size.width + constants.nodeGap;
        maxCellHeight = Math.max(maxCellHeight, size.height);
      }
      if (children.length > 0) {
        contentWidth -= constants.nodeGap;
      }
      contentWidth += constants.groupInnerRightPadding;
      groupWidth = Math.max(constants.columnWidth, contentWidth);
      expandedHeight =
        constants.groupHeaderHeight +
        constants.groupInnerTopPadding +
        maxCellHeight +
        constants.groupInnerBottomPadding;
    } else {
      let stackedY = constants.groupHeaderHeight + constants.groupInnerTopPadding;
      let stackedContentHeight = constants.groupInnerTopPadding;
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        const size = sizes[index];
        if (child === undefined || size === undefined) {
          continue;
        }
        if (!collapsed) {
          childPositions.set(child.id, { x: constants.nodeXInset, y: stackedY });
        }
        stackedY += size.height + constants.nodeGap;
        stackedContentHeight += size.height + constants.nodeGap;
      }
      if (children.length > 0) {
        stackedContentHeight -= constants.nodeGap;
      }
      expandedHeight =
        constants.groupHeaderHeight + stackedContentHeight + constants.groupInnerBottomPadding;
    }

    groupStyles.set(group.id, {
      width: groupWidth,
      height: collapsed ? constants.collapsedGroupHeight : expandedHeight,
    });
  }

  return nodes.map((node) => {
    if (node.type === "group") {
      const style = groupStyles.get(node.id);
      if (style === undefined) {
        return node;
      }
      const prev = node.style as { width?: number; height?: number } | undefined;
      if (prev?.width === style.width && prev?.height === style.height) {
        return node;
      }
      return {
        ...node,
        style: { ...node.style, width: style.width, height: style.height },
      };
    }

    const position = childPositions.get(node.id);
    if (position === undefined) {
      return node;
    }
    if (node.position.x === position.x && node.position.y === position.y) {
      return node;
    }
    return { ...node, position };
  });
}

/** Whether measured layout would change any group bounds or child positions. */
export function measuredLayoutDiffers(
  before: Node[],
  after: Node[],
): boolean {
  if (before.length !== after.length) {
    return true;
  }
  const afterById = new Map(after.map((node) => [node.id, node]));
  for (const node of before) {
    const next = afterById.get(node.id);
    if (next === undefined) {
      return true;
    }
    if (Math.round(node.position.x) !== Math.round(next.position.x)) {
      return true;
    }
    if (Math.round(node.position.y) !== Math.round(next.position.y)) {
      return true;
    }
    if (node.type === "group") {
      const prevStyle = node.style as { width?: number; height?: number } | undefined;
      const nextStyle = next.style as { width?: number; height?: number } | undefined;
      if (Math.round(prevStyle?.width ?? 0) !== Math.round(nextStyle?.width ?? 0)) {
        return true;
      }
      if (Math.round(prevStyle?.height ?? 0) !== Math.round(nextStyle?.height ?? 0)) {
        return true;
      }
    }
  }
  return false;
}
