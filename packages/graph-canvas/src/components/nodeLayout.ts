/**
 * Node layout helpers — estimates for the first paint, measured sizes for
 * final group positioning after React Flow renders each node.
 */

import type { Node } from "reactflow";

import type { NodeModel } from "../types";
import type { PortPlacement } from "./InletOutletGrid";
import {
  CHIP_REMOVE_STRIP_WIDTH,
  displayInputPortName,
  PORT_EDGE_INSET,
  SIDES_PORT_LABEL_MIN,
  STACKED_CHIP_MIN_WIDTH,
} from "./portEditorShared";

export interface MeasuredSize {
  width: number;
  height: number;
}

export interface InsertSlotLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GroupLayoutConstants {
  columnWidth: number;
  columnGap: number;
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
const SIDES_GRID_GAP = 8;
const STACKED_PORT_GAP = 4;
const PORT_LABEL_CHAR_WIDTH = 7.2;
const PORT_LABEL_PADDING = 8;

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
    const inputWidth = showInlets(node.tag)
      ? estimateStackedPortRowWidth(node.inputs, "input", portsEditable)
      : 0;
    const outputWidth = showOutlets(node.tag)
      ? estimateStackedPortRowWidth(node.outputs, "output", portsEditable)
      : 0;
    return Math.max(220, inputWidth, outputWidth);
  }

  const rows = countSidePortRows(node, portsEditable);
  if (rows === 0 && !showInlets(node.tag) && !showOutlets(node.tag)) {
    return SIDES_MIN_WIDTH;
  }

  let width = SIDES_BODY_MIN_WIDTH;
  let columns = 0;
  if (showInlets(node.tag)) {
    width += maxPortColumnWidth(node.inputs, "input", portsEditable);
    columns += 1;
  }
  if (showOutlets(node.tag)) {
    width += maxPortColumnWidth(node.outputs, "output", portsEditable);
    columns += 1;
  }
  if (columns > 1) {
    width += SIDES_GRID_GAP;
  }
  return Math.max(SIDES_MIN_WIDTH, width);
}

function estimateStackedPortRowWidth(
  ports: string[],
  kind: "input" | "output",
  portsEditable: boolean,
): number {
  const columnWidths = ports.map((port) => portChipWidth(portLabel(kind, port), portsEditable));
  if (portsEditable) {
    columnWidths.push(STACKED_CHIP_MIN_WIDTH);
  }
  if (columnWidths.length === 0) {
    return 0;
  }
  const rowWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const gaps = Math.max(0, columnWidths.length - 1) * STACKED_PORT_GAP;
  return PORT_EDGE_INSET * 2 + rowWidth + gaps;
}

function maxPortColumnWidth(
  ports: string[],
  kind: "input" | "output",
  portsEditable: boolean,
): number {
  const labels = ports.map((port) => portLabel(kind, port));
  if (portsEditable) {
    labels.push("");
  }
  if (labels.length === 0) {
    return SIDES_PORT_LABEL_MIN;
  }
  return Math.max(...labels.map((label) => portChipWidth(label, portsEditable)));
}

function portChipWidth(label: string, portsEditable: boolean): number {
  const labelWidth = Math.max(SIDES_PORT_LABEL_MIN, approximateTextWidth(label));
  return portsEditable ? labelWidth + CHIP_REMOVE_STRIP_WIDTH : labelWidth;
}

function portLabel(kind: "input" | "output", value: string): string {
  return kind === "input" ? displayInputPortName(value) : value;
}

function approximateTextWidth(value: string): number {
  return Math.ceil(value.length * PORT_LABEL_CHAR_WIDTH + PORT_LABEL_PADDING);
}

/** Cumulative X for the nth horizontal cell (0-based), given prior cell widths. */
export function horizontalCellX(
  priorWidths: number[],
  startInset = 16,
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

/** Notebook container width for vertically stacked cells from the widest measured cell. */
export function stackedGroupWidth(maxCellWidth: number, constants: GroupLayoutConstants): number {
  return Math.max(
    constants.columnWidth,
    constants.nodeXInset + maxCellWidth + constants.groupInnerRightPadding,
  );
}

/** Notebook container width for a horizontal row of cells. */
export function horizontalGroupWidth(
  cellWidths: number[],
  constants: GroupLayoutConstants,
): number {
  if (cellWidths.length === 0) {
    return constants.columnWidth;
  }
  let contentWidth = constants.nodeXInset;
  for (const width of cellWidths) {
    contentWidth += width + constants.nodeGap;
  }
  contentWidth -= constants.nodeGap;
  contentWidth += constants.groupInnerRightPadding;
  return Math.max(constants.columnWidth, contentWidth);
}

/** Cumulative X for the nth notebook group from prior group widths. */
export function groupColumnX(priorGroupWidths: number[], gap = 0): number {
  if (priorGroupWidths.length === 0) {
    return 0;
  }
  return priorGroupWidths.reduce((x: number, width: number) => x + width + gap, 0);
}

/** Cumulative Y for the nth notebook group from prior group heights. */
export function groupRowY(priorGroupHeights: number[], gap = 0): number {
  if (priorGroupHeights.length === 0) {
    return 0;
  }
  return priorGroupHeights.reduce((y: number, height: number) => y + height + gap, 0);
}

/** Positions gap drop targets immediately after each notebook node in a group. */
export function layoutInsertSlotsForGroup(
  children: Node[],
  sizes: MeasuredSize[],
  childPositions: ReadonlyMap<string, { x: number; y: number }>,
  constants: GroupLayoutConstants,
  horizontalCells: boolean,
  groupId: string,
  groupWidth: number,
  maxCellHeight: number,
): Map<string, InsertSlotLayout> {
  const slots = new Map<string, InsertSlotLayout>();
  const innerWidth = Math.max(
    groupWidth - constants.nodeXInset - constants.groupInnerRightPadding,
    constants.nodeGap,
  );

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const size = sizes[index];
    const position = childPositions.get(child?.id ?? "");
    if (child === undefined || size === undefined || position === undefined) {
      continue;
    }
    const data = child.data as { cellIndices?: number[] };
    const afterCellIndex = data.cellIndices?.[0] ?? 0;
    const slotId = `insert:${groupId}::${String(afterCellIndex)}`;
    if (horizontalCells) {
      slots.set(slotId, {
        x: position.x + size.width,
        y: position.y,
        width: constants.nodeGap,
        height: maxCellHeight,
      });
    } else {
      slots.set(slotId, {
        x: constants.nodeXInset,
        y: position.y + size.height,
        width: innerWidth,
        height: constants.nodeGap,
      });
    }
  }

  return slots;
}

/** Reposition notebook nodes and resize groups from measured DOM dimensions. */
export function applyMeasuredGroupLayout(
  nodes: Node[],
  measured: ReadonlyMap<string, MeasuredSize>,
  horizontalCells: boolean,
  constants: GroupLayoutConstants,
  fallbackSize: (node: Node) => MeasuredSize,
  manualGroupIds?: ReadonlySet<string>,
): Node[] {
  const groupNodes = nodes.filter((node) => node.type === "group");
  if (groupNodes.length === 0) {
    return nodes;
  }

  const childPositions = new Map<string, { x: number; y: number }>();
  const insertSlotLayouts = new Map<string, InsertSlotLayout>();
  const groupStyles = new Map<string, { width: number; height: number }>();
  const groupPositions = new Map<string, { x: number; y: number }>();

  const sortedGroups = horizontalCells
    ? [...groupNodes].sort((a, b) => a.position.y - b.position.y)
    : [...groupNodes].sort((a, b) => a.position.x - b.position.x);
  const priorGroupWidths: number[] = [];
  const priorGroupHeights: number[] = [];

  for (const group of sortedGroups) {
    const groupData = group.data as { id?: string };
    const groupNotebookId = groupData.id ?? group.id.replace(/^group:/, "");
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
      const cellWidths = sizes.map((size) => size.width);
      let maxCellHeight = 0;
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        const size = sizes[index];
        if (child === undefined || size === undefined) {
          continue;
        }
        if (!collapsed) {
          childPositions.set(child.id, {
            x: horizontalCellX(cellWidths.slice(0, index), constants.nodeXInset, constants.nodeGap),
            y: constants.groupHeaderHeight + constants.groupInnerTopPadding,
          });
        }
        maxCellHeight = Math.max(maxCellHeight, size.height);
      }
      groupWidth = horizontalGroupWidth(cellWidths, constants);
      expandedHeight =
        constants.groupHeaderHeight +
        constants.groupInnerTopPadding +
        maxCellHeight +
        constants.groupInnerBottomPadding;
      if (!collapsed) {
        const slots = layoutInsertSlotsForGroup(
          children,
          sizes,
          childPositions,
          constants,
          true,
          groupNotebookId,
          groupWidth,
          maxCellHeight,
        );
        for (const [slotId, layout] of slots) {
          insertSlotLayouts.set(slotId, layout);
        }
      }
    } else {
      let maxCellWidth = 0;
      let stackedY = constants.groupHeaderHeight + constants.groupInnerTopPadding;
      let stackedContentHeight = constants.groupInnerTopPadding;
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        const size = sizes[index];
        if (child === undefined || size === undefined) {
          continue;
        }
        maxCellWidth = Math.max(maxCellWidth, size.width);
        if (!collapsed) {
          childPositions.set(child.id, { x: constants.nodeXInset, y: stackedY });
        }
        stackedY += size.height + constants.nodeGap;
        stackedContentHeight += size.height + constants.nodeGap;
      }
      if (children.length > 0) {
        stackedContentHeight -= constants.nodeGap;
      }
      groupWidth = stackedGroupWidth(maxCellWidth, constants);
      expandedHeight =
        constants.groupHeaderHeight + stackedContentHeight + constants.groupInnerBottomPadding;
      if (!collapsed) {
        const slots = layoutInsertSlotsForGroup(
          children,
          sizes,
          childPositions,
          constants,
          false,
          groupNotebookId,
          groupWidth,
          0,
        );
        for (const [slotId, layout] of slots) {
          insertSlotLayouts.set(slotId, layout);
        }
      }
    }

    groupStyles.set(group.id, {
      width: groupWidth,
      height: collapsed ? constants.collapsedGroupHeight : expandedHeight,
    });
    const groupHeight = collapsed ? constants.collapsedGroupHeight : expandedHeight;
    const preservePosition = manualGroupIds?.has(groupNotebookId) === true;
    groupPositions.set(
      group.id,
      preservePosition
        ? group.position
        : horizontalCells
          ? {
              x: group.position.x,
              y: groupRowY(priorGroupHeights, constants.columnGap),
            }
          : {
              x: groupColumnX(priorGroupWidths, constants.columnGap),
              y: group.position.y,
            },
    );
    priorGroupWidths.push(groupWidth);
    priorGroupHeights.push(groupHeight);
  }

  return nodes.map((node) => {
    if (node.type === "group") {
      const style = groupStyles.get(node.id);
      const position = groupPositions.get(node.id);
      if (style === undefined || position === undefined) {
        return node;
      }
      const prev = node.style as { width?: number; height?: number } | undefined;
      const sizeUnchanged = prev?.width === style.width && prev?.height === style.height;
      const positionUnchanged = node.position.x === position.x && node.position.y === position.y;
      if (sizeUnchanged && positionUnchanged) {
        return node;
      }
      return {
        ...node,
        position,
        style: { ...node.style, width: style.width, height: style.height },
      };
    }

    const position = childPositions.get(node.id);
    if (position !== undefined) {
      if (node.position.x === position.x && node.position.y === position.y) {
        return node;
      }
      return { ...node, position };
    }

    if (node.type === "insertSlot") {
      const slotLayout = insertSlotLayouts.get(node.id);
      if (slotLayout === undefined) {
        return node;
      }
      const prevStyle = node.style as { width?: number; height?: number } | undefined;
      const sizeUnchanged =
        prevStyle?.width === slotLayout.width && prevStyle?.height === slotLayout.height;
      const positionUnchanged =
        node.position.x === slotLayout.x && node.position.y === slotLayout.y;
      if (sizeUnchanged && positionUnchanged) {
        return node;
      }
      return {
        ...node,
        position: { x: slotLayout.x, y: slotLayout.y },
        style: { ...node.style, width: slotLayout.width, height: slotLayout.height },
      };
    }

    return node;
  });
}

/** Whether measured layout would change any group bounds or child positions. */
export function measuredLayoutDiffers(before: Node[], after: Node[]): boolean {
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
