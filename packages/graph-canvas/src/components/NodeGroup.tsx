/**
 * NodeGroup — renders a notebook as a header card on the canvas.
 *
 * Phase-2 form: a labelled chip showing the notebook filename and a
 * collapse toggle. Nodes belonging to the group are rendered as standalone
 * React Flow nodes positioned beneath this header. A future iteration will
 * promote this to a true React Flow parent node (with children nested via
 * `parentNode`/`extent: 'parent'`) once layout/dragging behaviour is
 * worked out.
 */

import type { CSSProperties, ReactElement } from "react";
import type { NodeProps } from "reactflow";

import type { NodeGroupModel } from "../types";

export interface NodeGroupData extends NodeGroupModel {
  onToggle?: (groupId: string) => void;
}

const GROUP_BACKGROUND = "var(--notebookflow-group-bg, var(--muted, #f3f4f6))";
const GROUP_FOREGROUND = "var(--notebookflow-group-fg, var(--foreground, #111827))";
const GROUP_MUTED = "var(--notebookflow-group-muted, var(--muted-foreground, #6b7280))";
const GROUP_BORDER = "var(--notebookflow-group-border, var(--border, #d1d5db))";
const GROUP_FONT_FAMILY =
  "var(--notebookflow-font-family, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif)";

interface NodeGroupStyles {
  wrapper: CSSProperties;
  toggleButton: CSSProperties;
  label: CSSProperties;
  path: CSSProperties;
}

export function NodeGroup(props: NodeProps<NodeGroupData>): ReactElement {
  const { data, selected } = props;
  const styles = groupStyles(selected);

  const handleToggle = (): void => {
    if (data.onToggle !== undefined) {
      data.onToggle(data.id);
    }
  };

  return (
    <div style={styles.wrapper}>
      <button
        type="button"
        onClick={handleToggle}
        aria-label={data.collapsed ? "Expand notebook" : "Collapse notebook"}
        style={styles.toggleButton}
      >
        {data.collapsed ? "▶" : "▼"}
      </button>
      <span style={styles.label}>{data.name}</span>
      <span style={styles.path} title={data.notebookPath}>
        {data.notebookPath}
      </span>
    </div>
  );
}

function groupStyles(selected: boolean): NodeGroupStyles {
  return {
    wrapper: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      minWidth: 220,
      maxWidth: 320,
      padding: "6px 10px",
      borderRadius: 10,
      border: `2px solid ${selected ? "var(--notebookflow-group-selected-border, var(--foreground, #111827))" : GROUP_BORDER}`,
      background: GROUP_BACKGROUND,
      color: GROUP_FOREGROUND,
      fontFamily: GROUP_FONT_FAMILY,
      fontSize: 12,
      lineHeight: 1.3,
      boxShadow: "0 1px 2px rgba(15, 23, 42, 0.12)",
      boxSizing: "border-box",
    },
    toggleButton: {
      appearance: "none",
      border: "none",
      background: "transparent",
      padding: 0,
      margin: 0,
      color: "inherit",
      font: "inherit",
      fontSize: 14,
      lineHeight: 1,
      cursor: "pointer",
      flexShrink: 0,
    },
    label: {
      fontWeight: 600,
      flexShrink: 0,
    },
    path: {
      minWidth: 0,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      color: GROUP_MUTED,
      fontSize: 11,
    },
  };
}
