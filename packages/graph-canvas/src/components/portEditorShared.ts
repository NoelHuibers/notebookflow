import type { CSSProperties } from "react";

export const NODE_MUTED = "var(--notebookflow-node-muted, var(--muted-foreground, #6b7280))";
export const NODE_BORDER = "var(--notebookflow-node-border, var(--border, #d1d5db))";
export const NODE_BACKGROUND = "var(--notebookflow-node-bg, var(--card, #ffffff))";
export const NODE_FOREGROUND = "var(--notebookflow-node-fg, var(--card-foreground, #111827))";

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
    alignItems: "center",
    gap: 2,
    borderRadius: 6,
    border: `1px solid ${NODE_BORDER}`,
    background: "rgba(127, 127, 127, 0.08)",
    padding: "0 2px 0 4px",
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
    lineHeight: 1.4,
    padding: 0,
    cursor: "text",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 120,
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
