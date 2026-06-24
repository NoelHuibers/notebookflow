/**
 * NotebookNode — renders a single cell-group node on the canvas.
 *
 * Header shows the node name, an explicit rename button, and a tag chip.
 * Input handles on the left, one per declared `in=` ref. Output handles on
 * the right, one per declared `out=` port name. Rename flows through the
 * host-provided callback that the Canvas passes via `data`.
 *
 * Styling is explicit so the shared node surface stays stable across hosts,
 * while still allowing a host to override palette tokens via CSS variables
 * such as `--card`, `--foreground`, and `--border`.
 */

import { Pencil } from "lucide-react";
import type { ChangeEvent, CSSProperties, KeyboardEvent, ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import type { NodeProps } from "reactflow";
import { Handle, Position } from "reactflow";

import type { NodeModel, NodeTag, RuntimeState } from "../types";
import { PortEditor } from "./PortEditor";

export interface NotebookNodeData extends NodeModel {
  onRename?: (nodeId: string, nextName: string) => void;
  /** Replace the node's declared input refs (nodeName.portName). */
  onInputsChange?: (nodeId: string, nextInputs: string[]) => void;
  /** Replace the node's declared output port names. */
  onOutputsChange?: (nodeId: string, nextOutputs: string[]) => void;
  /** Autocomplete suggestions for input refs (upstream nodeName.portName). */
  inputSuggestions?: string[];
  /** Autocomplete suggestions for output port names. */
  outputSuggestions?: string[];
  /** Execution state from the host; absent means "idle". */
  runtimeState?: RuntimeState;
  /** Last-run duration in milliseconds. Shown next to the status dot. */
  runtimeDurationMs?: number;
  /**
   * Data hints for the meta line: the input filename (static, from source)
   * and the output row count (post-run, from the engine). Either may be
   * absent; both absent means no meta line renders.
   */
  meta?: { filename?: string; rows?: number };
  /** Declared input refs that don't resolve to any wire (e.g. a missing
   * cross-notebook alias/node). Surfaced as a warning on the node. */
  unresolvedInputs?: string[];
}

interface RuntimeBadge {
  label: string;
  color: string;
  glow: string | null;
}

const RUNTIME_BADGES: Record<RuntimeState, RuntimeBadge> = {
  idle: { label: "idle", color: "#9ca3af", glow: null },
  queued: { label: "queued", color: "#2dd4bf", glow: "rgba(45, 212, 191, 0.55)" },
  running: { label: "running", color: "#2dd4bf", glow: "rgba(45, 212, 191, 0.85)" },
  ok: { label: "ok", color: "#10b981", glow: null },
  error: { label: "error", color: "#ef4444", glow: null },
  skipped: { label: "skipped", color: "#f59e0b", glow: null },
};

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
  titleRow: CSSProperties;
  renameButton: CSSProperties;
  renameAction: CSSProperties;
  renameInput: CSSProperties;
  tagChip: CSSProperties;
  meta: CSSProperties;
  emptyState: CSSProperties;
}

export function NotebookNode(props: NodeProps<NotebookNodeData>): ReactElement {
  const { data, selected } = props;
  const styles = nodeStyles(data.tag, selected);
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(data.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Input nodes only emit values, output nodes only consume them. Everything
  // else can do both.
  const showInput = data.tag !== "input";
  const showOutput = data.tag !== "output";

  useEffect(() => {
    if (!isEditing) {
      setDraftName(data.name);
    }
  }, [data.name, isEditing]);

  useEffect(() => {
    if (isEditing) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [isEditing]);

  const openRename = (): void => {
    if (data.onRename === undefined) {
      return;
    }
    setDraftName(data.name);
    setIsEditing(true);
  };

  const cancelRename = (): void => {
    setDraftName(data.name);
    setIsEditing(false);
  };

  const commitRename = (): void => {
    if (data.onRename === undefined) {
      cancelRename();
      return;
    }
    const next = (renameInputRef.current?.value ?? draftName).trim();
    setIsEditing(false);
    if (next !== "" && next !== data.name) {
      data.onRename(data.id, next);
    }
  };

  const handleDraftChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setDraftName(event.target.value);
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  };

  const runtime = RUNTIME_BADGES[data.runtimeState ?? "idle"];
  const durationLabel = formatDuration(data.runtimeDurationMs);
  const metaLabel = formatMeta(data.meta);

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <div style={styles.titleRow}>
          <span
            role="img"
            aria-label={`Status: ${runtime.label}`}
            title={`Status: ${runtime.label}`}
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              flexShrink: 0,
              background: runtime.color,
              boxShadow: runtime.glow === null ? "none" : `0 0 6px ${runtime.glow}`,
            }}
          />
          {durationLabel !== null && (
            <span
              title={`Last run: ${durationLabel}`}
              style={{
                fontSize: 10,
                color: NODE_MUTED,
                fontVariantNumeric: "tabular-nums",
                flexShrink: 0,
              }}
            >
              {durationLabel}
            </span>
          )}
          {isEditing ? (
            <input
              ref={renameInputRef}
              aria-label="Node name"
              className="nodrag nopan"
              value={draftName}
              onChange={handleDraftChange}
              onBlur={commitRename}
              onKeyDown={handleRenameKeyDown}
              style={styles.renameInput}
            />
          ) : (
            <>
              <button
                type="button"
                className="nodrag nopan"
                onDoubleClick={openRename}
                title="Double-click to rename"
                style={styles.renameButton}
              >
                {data.name}
              </button>
              <button
                type="button"
                className="nodrag nopan"
                onClick={openRename}
                aria-label="Rename node"
                title="Rename node"
                style={styles.renameAction}
              >
                <Pencil aria-hidden="true" size={12} strokeWidth={2} />
              </button>
            </>
          )}
        </div>
        <span style={styles.tagChip}>{data.tag}</span>
      </div>
      <div style={styles.meta}>
        {metaLabel !== null && (
          <div
            title="Input file · output rows"
            style={{ fontSize: 10, color: NODE_MUTED, fontVariantNumeric: "tabular-nums" }}
          >
            {metaLabel}
          </div>
        )}
        {data.unresolvedInputs !== undefined && data.unresolvedInputs.length > 0 && (
          <div
            title={`Unresolved input refs:\n${data.unresolvedInputs.join("\n")}`}
            style={{ fontSize: 10, color: "#b45309", fontWeight: 500 }}
          >
            ⚠ unresolved: {data.unresolvedInputs.join(", ")}
          </div>
        )}
        {showInput &&
          (data.onInputsChange !== undefined ? (
            <PortEditor
              kind="input"
              ports={data.inputs}
              suggestions={data.inputSuggestions ?? []}
              onChange={(next) => {
                data.onInputsChange?.(data.id, next);
              }}
            />
          ) : (
            data.inputs.length > 0 && (
              <div>
                <strong>in:</strong> {data.inputs.join(", ")}
              </div>
            )
          ))}
        {showOutput &&
          (data.onOutputsChange !== undefined ? (
            <PortEditor
              kind="output"
              ports={data.outputs}
              suggestions={data.outputSuggestions ?? []}
              onChange={(next) => {
                data.onOutputsChange?.(data.id, next);
              }}
            />
          ) : (
            data.outputs.length > 0 && (
              <div>
                <strong>out:</strong> {data.outputs.join(", ")}
              </div>
            )
          ))}
        {data.onInputsChange === undefined &&
          data.onOutputsChange === undefined &&
          data.inputs.length === 0 &&
          data.outputs.length === 0 && <span style={styles.emptyState}>no ports</span>}
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

function formatDuration(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return null;
  }
  if (ms < 1) {
    return "<1ms";
  }
  if (ms < 1000) {
    return `${String(Math.round(ms))}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatMeta(meta: NotebookNodeData["meta"]): string | null {
  if (meta === undefined) {
    return null;
  }
  const parts: string[] = [];
  if (meta.filename !== undefined && meta.filename !== "") {
    parts.push(meta.filename);
  }
  if (meta.rows !== undefined && Number.isFinite(meta.rows)) {
    parts.push(`${meta.rows.toLocaleString()} rows`);
  }
  return parts.length === 0 ? null : parts.join(" · ");
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
      // Visible so an open port dropdown can float past the node edges.
      overflow: "visible",
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
      borderTopLeftRadius: 6,
      borderTopRightRadius: 6,
      boxSizing: "border-box",
    },
    titleRow: {
      display: "flex",
      alignItems: "center",
      gap: 4,
      minWidth: 0,
      flex: 1,
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
      textAlign: "left",
      cursor: "text",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      minWidth: 0,
      flex: "0 1 auto",
    },
    renameAction: {
      appearance: "none",
      border: "none",
      borderRadius: 4,
      background: "transparent",
      color: "inherit",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      lineHeight: 0,
      padding: 2,
      cursor: "pointer",
      opacity: 0.78,
      flexShrink: 0,
    },
    renameInput: {
      appearance: "none",
      border: "1px solid rgba(255, 255, 255, 0.45)",
      borderRadius: 6,
      background: "rgba(255, 255, 255, 0.16)",
      color: "inherit",
      font: "inherit",
      fontWeight: 600,
      lineHeight: 1.2,
      padding: "4px 8px",
      minWidth: 0,
      width: "100%",
      outline: "none",
      boxSizing: "border-box",
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
      display: "flex",
      flexDirection: "column",
      gap: 4,
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
