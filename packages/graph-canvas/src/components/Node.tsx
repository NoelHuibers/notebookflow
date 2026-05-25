/**
 * NotebookNode — renders a single cell-group node on the canvas.
 *
 * Header shows the node name and a tag chip. Input handles on the left, one
 * per declared `in=` ref. Output handles on the right, one per declared
 * `out=` port name. Double-click the name to rename via the host-provided
 * callback (the Canvas passes it through `data`).
 *
 * Styling is explicit so the shared node surface stays stable across hosts,
 * while still allowing a host to override palette tokens via CSS variables
 * such as `--card`, `--foreground`, and `--border`.
 */

import type { CSSProperties, ReactElement } from "react";
import type { NodeProps } from "reactflow";
import { Handle, Position } from "reactflow";

import type { NodeModel, NodeTag } from "../types";

export interface NotebookNodeData extends NodeModel {
  onRename?: (nodeId: string, nextName: string) => void;
}

const TAG_HEADER_BG: Record<NodeTag, string> = {
  input: "#3b82f6",
  transform: "#10b981",
  output: "#ef4444",
  ai: "#a855f7",
  io: "#f97316",
};

const TAG_RING: Record<NodeTag, string> = {
  input: "rgba(59, 130, 246, 0.28)",
  transform: "rgba(16, 185, 129, 0.28)",
  output: "rgba(239, 68, 68, 0.28)",
  ai: "rgba(168, 85, 247, 0.28)",
  io: "rgba(249, 115, 22, 0.28)",
};

const TAG_HANDLE_COLOR: Record<NodeTag, string> = {
  input: "#3b82f6",
  transform: "#10b981",
  output: "#ef4444",
  ai: "#a855f7",
  io: "#f97316",
};

const NODE_BACKGROUND = "var(--notebookflow-node-bg, var(--card, #ffffff))";
const NODE_FOREGROUND = "var(--notebookflow-node-fg, var(--card-foreground, #111827))";
const NODE_MUTED = "var(--notebookflow-node-muted, var(--muted-foreground, #6b7280))";
const NODE_BORDER = "var(--notebookflow-node-border, var(--border, #d1d5db))";
const NODE_FONT_FAMILY =
  "var(--notebookflow-font-family, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif)";

interface NotebookNodeStyles {
  wrapper: CSSProperties;
  header: CSSProperties;
  renameButton: CSSProperties;
  tagChip: CSSProperties;
  meta: CSSProperties;
  emptyState: CSSProperties;
}

export function NotebookNode(props: NodeProps<NotebookNodeData>): ReactElement {
  const { data, selected } = props;
  const styles = nodeStyles(data.tag, selected);

  const handleRename = (): void => {
    if (data.onRename === undefined) {
      return;
    }
    const next = globalThis.prompt("New node name:", data.name);
    if (next !== null && next.trim() !== "" && next !== data.name) {
      data.onRename(data.id, next.trim());
    }
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <button
          type="button"
          onDoubleClick={handleRename}
          title="Double-click to rename"
          style={styles.renameButton}
        >
          {data.name}
        </button>
        <span style={styles.tagChip}>{data.tag}</span>
      </div>
      <div style={styles.meta}>
        {data.inputs.length === 0 && data.outputs.length === 0 ? (
          <span style={styles.emptyState}>no ports</span>
        ) : (
          <>
            {data.inputs.length > 0 && (
              <div>
                <strong>in:</strong> {data.inputs.join(", ")}
              </div>
            )}
            {data.outputs.length > 0 && (
              <div>
                <strong>out:</strong> {data.outputs.join(", ")}
              </div>
            )}
          </>
        )}
      </div>
      {data.inputs.map((ref, idx) => (
        <Handle
          key={`in-${ref}`}
          id={ref}
          type="target"
          position={Position.Left}
          style={handleStyle(idx, data.inputs.length, data.tag)}
        />
      ))}
      {data.outputs.map((port, idx) => (
        <Handle
          key={`out-${port}`}
          id={port}
          type="source"
          position={Position.Right}
          style={handleStyle(idx, data.outputs.length, data.tag)}
        />
      ))}
    </div>
  );
}

function handleStyle(index: number, total: number, tag: NodeTag): CSSProperties {
  return {
    top: portOffset(index, total),
    width: 10,
    height: 10,
    borderRadius: 999,
    border: `2px solid ${NODE_BACKGROUND}`,
    background: TAG_HANDLE_COLOR[tag],
    boxSizing: "border-box",
  };
}

function portOffset(index: number, total: number): string {
  if (total <= 1) {
    return "50%";
  }
  const pct = 30 + (index / (total - 1)) * 40;
  return `${String(pct)}%`;
}

function nodeStyles(tag: NodeTag, selected: boolean): NotebookNodeStyles {
  return {
    wrapper: {
      minWidth: 200,
      borderRadius: 8,
      border: `2px solid ${selected ? "var(--notebookflow-node-selected-border, var(--foreground, #111827))" : NODE_BORDER}`,
      background: NODE_BACKGROUND,
      color: NODE_FOREGROUND,
      fontFamily: NODE_FONT_FAMILY,
      fontSize: 14,
      lineHeight: 1.4,
      boxShadow: selected
        ? `0 0 0 2px ${TAG_RING[tag]}, 0 1px 2px rgba(15, 23, 42, 0.14)`
        : "0 1px 2px rgba(15, 23, 42, 0.14)",
      overflow: "hidden",
      boxSizing: "border-box",
    },
    header: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      padding: "6px 8px",
      background: TAG_HEADER_BG[tag],
      color: "#ffffff",
      boxSizing: "border-box",
    },
    renameButton: {
      appearance: "none",
      border: "none",
      background: "transparent",
      padding: 0,
      margin: 0,
      color: "inherit",
      font: "inherit",
      fontWeight: 600,
      lineHeight: 1.2,
      cursor: "text",
      textAlign: "left",
      userSelect: "none",
    },
    tagChip: {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      background: "rgba(0, 0, 0, 0.2)",
      padding: "1px 6px",
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      lineHeight: 1.2,
      boxSizing: "border-box",
    },
    meta: {
      padding: "6px 8px",
      fontSize: 12,
      color: NODE_MUTED,
      boxSizing: "border-box",
    },
    emptyState: {
      fontStyle: "italic",
      opacity: 0.78,
    },
  };
}
