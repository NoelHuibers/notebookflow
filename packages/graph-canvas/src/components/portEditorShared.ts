import type { CSSProperties } from "react";

export const NODE_MUTED = "var(--notebookflow-node-muted, var(--muted-foreground, #6b7280))";
export const NODE_BORDER = "var(--notebookflow-node-border, var(--border, #d1d5db))";
export const NODE_BACKGROUND = "var(--notebookflow-node-bg, var(--card, #ffffff))";
export const NODE_FOREGROUND = "var(--notebookflow-node-fg, var(--card-foreground, #111827))";

/** Minimum label width for side (horizontal) port bands. */
export const SIDES_PORT_LABEL_MIN = 96;
export const SIDES_PORT_LABEL_MAX = 168;
/** Width of the × remove strip on port chips (label + strip = chip min width). */
export const CHIP_REMOVE_STRIP_WIDTH = 26;
/** Minimum stacked port column / chip width — keeps chips inside padded rails. */
export const STACKED_CHIP_MIN_WIDTH: number = SIDES_PORT_LABEL_MIN + CHIP_REMOVE_STRIP_WIDTH;
/** Minimum width per port column in stacked (vertical) layout. */
export const STACKED_PORT_COLUMN_MIN: number = STACKED_CHIP_MIN_WIDTH;
/** Maximum width per port column before wrapping to additional lines. */
export const STACKED_PORT_COLUMN_MAX = 184;
/** Inset for port chips from the cell edge; pairs with handle edge offset in each layout. */
export const PORT_EDGE_INSET = 6;

/** Ellipsis at the text start so port suffixes (e.g. `.df`) stay visible when truncated. */
export function portLabelEllipsis(textAlign: "left" | "right" = "left"): CSSProperties {
  return {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    direction: "rtl",
    textAlign,
  };
}
export const NAME_RE: RegExp = /^[A-Za-z0-9 _-]+$/;
export const PORT_RE: RegExp = /^[a-z][a-z0-9_]*$/;

export type PortKind = "input" | "output";

/** Handle id for a drop target that accepts a new upstream wire. */
export const INLET_DROP_HANDLE_ID = "__in__";

/** Validate a candidate value for the given port kind. */
export function isValidPort(kind: PortKind, value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") {
    return false;
  }
  if (kind === "output") {
    return PORT_RE.test(trimmed);
  }
  const dotIdx = trimmed.lastIndexOf(".");
  if (dotIdx === -1) {
    return false;
  }
  const nodeName = trimmed.slice(0, dotIdx).trim();
  const portName = trimmed.slice(dotIdx + 1).trim();
  return NAME_RE.test(nodeName) && PORT_RE.test(portName);
}

interface PortChipStyles {
  chip: CSSProperties;
  chipLabel: CSSProperties;
  sidesChip: CSSProperties;
  sidesChipLabelRegion: CSSProperties;
  sidesChipRemoveRegion: CSSProperties;
  sidesChipRemove: CSSProperties;
  readOnlyPort: CSSProperties;
  readOnlyPortSideRight: CSSProperties;
  chipRemove: CSSProperties;
  addButton: CSSProperties;
  combobox: CSSProperties;
  comboInput: CSSProperties;
  comboList: CSSProperties;
  comboOption: CSSProperties;
}

export const portChipStyles: PortChipStyles = {
  chip: {
    display: "inline-flex",
    alignItems: "flex-start",
    gap: 2,
    borderRadius: 6,
    border: `1px solid ${NODE_BORDER}`,
    background: "rgba(127, 127, 127, 0.08)",
    padding: "1px 2px 1px 4px",
    maxWidth: "100%",
    boxSizing: "border-box",
  },
  chipLabel: {
    appearance: "none",
    border: "none",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontSize: 12,
    lineHeight: 1.35,
    padding: 0,
    cursor: "text",
    minWidth: 0,
    maxWidth: "100%",
    width: "100%",
    ...portLabelEllipsis("left"),
  },
  sidesChip: {
    display: "inline-flex",
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: 6,
    border: `1px solid ${NODE_BORDER}`,
    background: "rgba(127, 127, 127, 0.08)",
    padding: 0,
    minWidth: SIDES_PORT_LABEL_MIN + CHIP_REMOVE_STRIP_WIDTH,
    maxWidth: "100%",
    boxSizing: "border-box",
    overflow: "hidden",
  },
  sidesChipLabelRegion: {
    display: "flex",
    alignItems: "center",
    minWidth: SIDES_PORT_LABEL_MIN,
    maxWidth: SIDES_PORT_LABEL_MAX,
    flex: 1,
    padding: "2px 4px",
    boxSizing: "border-box",
  },
  sidesChipRemoveRegion: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderLeft: `1px solid ${NODE_BORDER}`,
    background: "rgba(127, 127, 127, 0.06)",
    padding: "0 1px",
    boxSizing: "border-box",
    flexShrink: 0,
  },
  sidesChipRemove: {
    appearance: "none",
    border: "none",
    borderRadius: 0,
    background: "transparent",
    color: "inherit",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 0,
    padding: "2px 4px",
    cursor: "pointer",
    opacity: 0.6,
  },
  readOnlyPort: {
    fontSize: 12,
    lineHeight: 1.4,
    maxWidth: "100%",
    ...portLabelEllipsis("left"),
  },
  readOnlyPortSideRight: {
    fontSize: 12,
    lineHeight: 1.4,
    maxWidth: "100%",
    width: "100%",
    ...portLabelEllipsis("right"),
  },
  chipRemove: {
    appearance: "none",
    border: "none",
    borderRadius: 4,
    background: "transparent",
    color: "inherit",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 0,
    padding: 1,
    cursor: "pointer",
    opacity: 0.6,
    flexShrink: 0,
  },
  addButton: {
    appearance: "none",
    border: `1px dashed ${NODE_BORDER}`,
    borderRadius: 6,
    background: "transparent",
    color: NODE_MUTED,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 0,
    padding: 2,
    cursor: "pointer",
  },
  combobox: {
    position: "relative",
    display: "inline-flex",
  },
  comboInput: {
    appearance: "none",
    border: `1px solid ${NODE_BORDER}`,
    borderRadius: 6,
    background: NODE_BACKGROUND,
    color: NODE_FOREGROUND,
    font: "inherit",
    fontSize: 12,
    lineHeight: 1.4,
    padding: "2px 6px",
    width: 140,
    outline: "none",
    boxSizing: "border-box",
  },
  comboList: {
    position: "absolute",
    top: "calc(100% + 2px)",
    left: 0,
    zIndex: 1,
    margin: 0,
    padding: 4,
    listStyle: "none",
    minWidth: 160,
    maxHeight: 180,
    overflowY: "auto",
    borderRadius: 8,
    border: `1px solid ${NODE_BORDER}`,
    background: NODE_BACKGROUND,
    color: NODE_FOREGROUND,
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.18)",
  },
  comboOption: {
    appearance: "none",
    border: "none",
    borderRadius: 6,
    width: "100%",
    textAlign: "left",
    font: "inherit",
    fontSize: 12,
    lineHeight: 1.4,
    padding: "4px 8px",
    color: "inherit",
    cursor: "pointer",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};
