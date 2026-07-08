/**
 * NodeGroup — renders a notebook as a translucent container that wraps its
 * child nodes on the canvas.
 *
 * The group is a React Flow node with its own width + height; child node
 * positions are relative to its top-left via `parentNode` + `extent:
 * "parent"`. The component below renders only the visible chrome: a header
 * strip with the notebook name and a collapse toggle.
 */

import type { CSSProperties, ReactElement } from "react";
import type { NodeProps } from "reactflow";

import { useCanvasLabels } from "../labels";
import type { NodeGroupModel } from "../types";

export interface NodeGroupData extends NodeGroupModel {
  active?: boolean;
  onToggle?: (groupId: string) => void;
}

export const NODE_GROUP_HEADER_HEIGHT = 36;

const GROUP_FOREGROUND = "var(--notebookflow-group-fg, var(--foreground, #111827))";
const GROUP_MUTED = "var(--notebookflow-group-muted, var(--muted-foreground, #6b7280))";
const GROUP_BORDER = "var(--notebookflow-group-border, var(--border, #d1d5db))";
const GROUP_TRANSLUCENT_BG = "var(--notebookflow-group-bg, rgba(243, 244, 246, 0.45))";
const GROUP_HEADER_BG = "var(--notebookflow-group-header-bg, rgba(243, 244, 246, 0.92))";
const GROUP_FONT_FAMILY =
  "var(--notebookflow-font-family, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif)";

interface NodeGroupStyles {
  wrapper: CSSProperties;
  header: CSSProperties;
  toggleButton: CSSProperties;
  label: CSSProperties;
  path: CSSProperties;
}

export function NodeGroup(props: NodeProps<NodeGroupData>): ReactElement {
  const { data, selected } = props;
  const labels = useCanvasLabels();
  const styles = groupStyles(selected, data.active === true, data.collapsed);

  const handleToggle = (event: React.MouseEvent<HTMLButtonElement>): void => {
    // Don't let the click bubble to React Flow's pane / node click handler.
    event.stopPropagation();
    if (data.onToggle !== undefined) {
      data.onToggle(data.id);
    }
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <button
          type="button"
          onClick={handleToggle}
          aria-label={data.collapsed ? labels.expandNotebook : labels.collapseNotebook}
          className="nodrag nopan"
          style={styles.toggleButton}
        >
          {data.collapsed ? "▶" : "▼"}
        </button>
        <span style={styles.label}>{data.name}</span>
        <span style={styles.path} title={data.notebookPath}>
          {data.notebookPath}
        </span>
      </div>
    </div>
  );
}

function groupStyles(selected: boolean, active: boolean, collapsed: boolean): NodeGroupStyles {
  const highlighted = active || selected;
  const borderColor = active
    ? "var(--notebookflow-group-active-border, var(--primary, #0d9488))"
    : selected
      ? "var(--notebookflow-group-selected-border, var(--foreground, #111827))"
      : GROUP_BORDER;
  return {
    wrapper: {
      width: "100%",
      height: "100%",
      borderRadius: 10,
      border: `1.5px ${highlighted ? "solid" : "dashed"} ${borderColor}`,
      // Collapsed groups become an opaque header chip; expanded groups stay
      // translucent so the canvas grid + child nodes inside remain visible.
      background: collapsed ? GROUP_HEADER_BG : GROUP_TRANSLUCENT_BG,
      color: GROUP_FOREGROUND,
      fontFamily: GROUP_FONT_FAMILY,
      fontSize: 12,
      lineHeight: 1.3,
      boxShadow: active ? "none" : selected ? "0 0 0 2px rgba(99, 102, 241, 0.18)" : "none",
      boxSizing: "border-box",
      overflow: "hidden",
    },
    header: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      height: NODE_GROUP_HEADER_HEIGHT,
      padding: "0 10px",
      background: GROUP_HEADER_BG,
      borderBottom: collapsed ? "none" : `1px solid ${borderColor}`,
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
