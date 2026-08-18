/**
 * NotebookNode — renders a single cell-group node on the canvas.
 *
 * Header shows the node name, an explicit rename button, and a tag chip.
 * Inlets and outlets adapt to canvas layout: side-by-side columns when the
 * graph flows horizontally (dagre), or stacked along the top/bottom edges
 * when nodes are arranged vertically (manual). Each port occupies one row with
 * its connector aligned to the label indent.
 *
 * Styling is explicit so the shared node surface stays stable across hosts,
 * while still allowing a host to override palette tokens via CSS variables
 * such as `--card`, `--foreground`, and `--border`.
 */

import { Pencil } from "lucide-react";
import type { ChangeEvent, CSSProperties, KeyboardEvent, ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import type { NodeProps } from "reactflow";

import { useCanvasLabels } from "../labels";
import type { NodeMeta, NodeModel, NodeTag, RuntimeState } from "../types";
import {
  InletOutletGrid,
  inletPortsVisible,
  NODE_CLIP_RADIUS,
  outletPortsVisible,
  type PortPlacement,
} from "./InletOutletGrid";
import { estimateNodeWidth } from "./nodeLayout";

export interface NotebookNodeData extends NodeModel {
  onRename?: (nodeId: string, nextName: string) => void;
  /** Replace the node's declared input bindings (`local<-nodeName.portName`). */
  onInputsChange?: (nodeId: string, nextInputs: string[]) => void;
  /** Replace the node's declared output port names. */
  onOutputsChange?: (nodeId: string, nextOutputs: string[]) => void;
  /** Autocomplete suggestions for source refs (upstream nodeName.portName). */
  inputSuggestions?: string[];
  /** Autocomplete suggestions for output port names. */
  outputSuggestions?: string[];
  /** Execution state from the host; absent means "idle". */
  runtimeState?: RuntimeState;
  /** Last-run duration in milliseconds. Shown next to the status dot. */
  runtimeDurationMs?: number;
  /**
   * Data hints for the meta line: the input filename (static, from source)
   * and the output row count (post-run, from the engine), plus optional
   * "changed since the previous run" deltas. Every field may be absent; a
   * meta with no filename/rows renders no meta line.
   */
  meta?: NodeMeta;
  /** Declared input refs that don't resolve to any wire (e.g. a missing
   * cross-notebook alias/node). Surfaced as a warning on the node. */
  unresolvedInputs?: string[];
  /** Port handle placement — stacked for vertical flow, sides for dagre. */
  portPlacement?: PortPlacement;
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

const NODE_BORDER_WIDTH = 2;
const NODE_OUTER_RADIUS = 8;
const NODE_SELECTION_OUTLINE = "var(--notebookflow-node-selected-outline, var(--primary, #0d9488))";

const NODE_BACKGROUND = "var(--notebookflow-node-bg, var(--card, #ffffff))";
const NODE_FOREGROUND = "var(--notebookflow-node-fg, var(--card-foreground, #111827))";
const NODE_MUTED = "var(--notebookflow-node-muted, var(--muted-foreground, #6b7280))";
const NODE_FONT_FAMILY =
  "var(--notebookflow-font-family, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif)";

interface StackedCornerOptions {
  roundHeaderTop: boolean;
  roundHeaderBottom: boolean;
  roundMetaBottom: boolean;
}

interface BodyCornerOptions {
  roundMetaBottom: boolean;
}

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
  duration: CSSProperties;
  durationDelta: CSSProperties;
  rowsDelta: CSSProperties;
}

export function NotebookNode(props: NodeProps<NotebookNodeData>): ReactElement {
  const { data, selected } = props;
  const labels = useCanvasLabels();
  const tagLabels = {
    input: labels.tagInput,
    transform: labels.tagTransform,
    output: labels.tagOutput,
    ai: labels.tagAi,
    io: labels.tagIo,
  };
  const statusLabels = {
    idle: labels.statusIdle,
    queued: labels.statusQueued,
    running: labels.statusRunning,
    ok: labels.statusOk,
    error: labels.statusError,
    skipped: labels.statusSkipped,
  };
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(data.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Input nodes only emit values, output nodes only consume them. Everything
  // else can do both.
  const showInlets = data.tag !== "input";
  const showOutlets = data.tag !== "output";
  const portsEditable = data.onInputsChange !== undefined || data.onOutputsChange !== undefined;
  const portPlacement = data.portPlacement ?? "stacked";
  const stackedPorts = portPlacement === "stacked";
  const metaLabel = formatMeta(data.meta);
  const topPortsVisible = inletPortsVisible(
    showInlets,
    data.inputs,
    portsEditable,
    data.onInputsChange !== undefined,
  );
  const bottomPortsVisible = outletPortsVisible(
    showOutlets,
    data.outputs,
    portsEditable,
    data.onOutputsChange !== undefined,
  );
  const hasMetaContent =
    metaLabel !== null || (data.unresolvedInputs !== undefined && data.unresolvedInputs.length > 0);
  const layoutHints = {
    portsEditable,
    hasMeta: hasMetaContent,
  };
  const showBodySection =
    hasMetaContent ||
    (!stackedPorts && (showInlets || showOutlets)) ||
    (!stackedPorts &&
      !portsEditable &&
      !showInlets &&
      !showOutlets &&
      data.inputs.length === 0 &&
      data.outputs.length === 0);
  const styles = nodeStyles(
    data.tag,
    selected,
    estimateNodeWidth(data, portPlacement, layoutHints),
    stackedPorts
      ? {
          layout: "stacked",
          roundHeaderTop: !topPortsVisible,
          roundHeaderBottom: !hasMetaContent && !bottomPortsVisible,
          roundMetaBottom: hasMetaContent && !bottomPortsVisible,
        }
      : showBodySection
        ? { layout: "body", roundMetaBottom: true }
        : undefined,
  );

  const portGridProps = {
    tag: data.tag,
    inputs: data.inputs,
    outputs: data.outputs,
    showInlets,
    showOutlets,
    editable: portsEditable,
    inputSuggestions: data.inputSuggestions ?? [],
    outputSuggestions: data.outputSuggestions ?? [],
    placement: portPlacement,
    ...(data.onInputsChange === undefined
      ? {}
      : {
          onInputsChange: (next: string[]) => {
            data.onInputsChange?.(data.id, next);
          },
        }),
    ...(data.onOutputsChange === undefined
      ? {}
      : {
          onOutputsChange: (next: string[]) => {
            data.onOutputsChange?.(data.id, next);
          },
        }),
  } as const;

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

  const runtimeState = data.runtimeState ?? "idle";
  const runtime = RUNTIME_BADGES[runtimeState];
  const statusLabel = statusLabels[runtimeState];
  const durationLabel = formatDuration(data.runtimeDurationMs);
  const durationDeltaLabel = formatSignedDuration(
    data.meta?.durationDeltaMs,
    data.runtimeDurationMs,
  );
  const rowsDeltaLabel = formatSignedCount(data.meta?.rowsDelta);
  // The dot already carries the current state; a status change only extends
  // its tooltip rather than adding new chrome to the node.
  const statusChanged = data.meta?.statusChanged;
  const statusTitle =
    statusChanged === undefined
      ? labels.statusTitle.replace("{status}", statusLabel)
      : `${labels.statusTitle.replace("{status}", statusLabel)} · ${labels.statusChangedTitle
          .replace("{from}", statusLabels[statusChanged.from])
          .replace("{to}", statusLabels[statusChanged.to])}`;

  const header = (
    <div style={styles.header}>
      <div style={styles.titleRow}>
        <span
          role="img"
          aria-label={statusTitle}
          title={statusTitle}
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
            title={labels.lastRunTitle.replace("{duration}", durationLabel)}
            style={styles.duration}
          >
            {durationLabel}
          </span>
        )}
        {durationLabel !== null && durationDeltaLabel !== null && (
          <span
            title={labels.durationDeltaTitle.replace("{delta}", durationDeltaLabel)}
            style={styles.durationDelta}
          >
            {durationDeltaLabel}
          </span>
        )}
        {isEditing ? (
          <input
            ref={renameInputRef}
            aria-label={labels.nodeNameAria}
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
              title={labels.renameHint}
              style={styles.renameButton}
            >
              {data.name}
            </button>
            <button
              type="button"
              className="nodrag nopan"
              onClick={openRename}
              aria-label={labels.renameNode}
              title={labels.renameNode}
              style={styles.renameAction}
            >
              <Pencil aria-hidden="true" size={12} strokeWidth={2} />
            </button>
          </>
        )}
      </div>
      <span style={styles.tagChip}>{tagLabels[data.tag]}</span>
    </div>
  );

  const bodyBlock = showBodySection ? (
    <div style={styles.meta}>
      {metaLabel !== null && (
        <div style={{ fontSize: 10, color: NODE_MUTED, fontVariantNumeric: "tabular-nums" }}>
          <span title={labels.nodeMetaTitle}>{metaLabel}</span>
          {rowsDeltaLabel !== null && (
            <span
              title={labels.rowsDeltaTitle.replace("{delta}", rowsDeltaLabel)}
              style={styles.rowsDelta}
            >
              {rowsDeltaLabel}
            </span>
          )}
        </div>
      )}
      {data.unresolvedInputs !== undefined && data.unresolvedInputs.length > 0 && (
        <div
          title={labels.unresolvedRefsTitle.replace("{refs}", data.unresolvedInputs.join("\n"))}
          style={{ fontSize: 10, color: "#b45309", fontWeight: 500 }}
        >
          ⚠ {labels.unresolvedShort.replace("{refs}", data.unresolvedInputs.join(", "))}
        </div>
      )}
      {!stackedPorts && (showInlets || showOutlets) && <InletOutletGrid {...portGridProps} />}
      {!stackedPorts &&
        !portsEditable &&
        !showInlets &&
        !showOutlets &&
        data.inputs.length === 0 &&
        data.outputs.length === 0 && <span style={styles.emptyState}>no ports</span>}
    </div>
  ) : null;

  return (
    <div style={styles.wrapper}>
      {stackedPorts && topPortsVisible && (
        <InletOutletGrid {...portGridProps} edge="top" clipCorner="top" />
      )}
      {header}
      {stackedPorts ? (hasMetaContent ? bodyBlock : null) : bodyBlock}
      {stackedPorts && bottomPortsVisible && (
        <InletOutletGrid {...portGridProps} edge="bottom" clipCorner="bottom" />
      )}
    </div>
  );
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

/**
 * Real minus sign (U+2212), not a hyphen — matches the app's typography and
 * keeps the sign legible at 10px. The explicit +/- means the direction of a
 * delta never depends on colour alone.
 */
const MINUS_SIGN = "−";

function signPrefix(value: number): string {
  return value < 0 ? MINUS_SIGN : "+";
}

/** Signed row-count delta, e.g. "+12" / "−4". Null when there's nothing to show. */
function formatSignedCount(delta: number | undefined): string | null {
  if (delta === undefined || !Number.isFinite(delta) || delta === 0) {
    return null;
  }
  return `${signPrefix(delta)}${Math.abs(delta).toLocaleString()}`;
}

/**
 * Signed duration delta, e.g. "+120ms" / "−0.4s". Null when there's nothing
 * to show. `baseMs` is the duration the delta annotates: it is rendered in
 * seconds past 1s, so a delta sitting next to it uses seconds too ("1.2s
 * −0.4s" rather than "1.2s −400ms") — unless that would round away to
 * "0.0s", in which case milliseconds stay.
 */
function formatSignedDuration(deltaMs: number | undefined, baseMs?: number): string | null {
  if (deltaMs === undefined || !Number.isFinite(deltaMs) || deltaMs === 0) {
    return null;
  }
  const magnitude = Math.round(Math.abs(deltaMs));
  if (magnitude === 0) {
    return null;
  }
  const baseInSeconds = baseMs !== undefined && Number.isFinite(baseMs) && baseMs >= 1000;
  const seconds = (magnitude / 1000).toFixed(1);
  const formatted =
    magnitude >= 1000 || (baseInSeconds && seconds !== "0.0")
      ? `${seconds}s`
      : `${String(magnitude)}ms`;
  return `${signPrefix(deltaMs)}${formatted}`;
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

type NodeCornerOptions =
  | ({ layout: "stacked" } & StackedCornerOptions)
  | ({ layout: "body" } & BodyCornerOptions);

function headerStyle(
  tagColor: string,
  options: { roundTop: boolean; roundBottom?: boolean },
  innerClip: number,
): CSSProperties {
  const { roundTop, roundBottom = false } = options;
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: roundTop
      ? `${String(6 + NODE_BORDER_WIDTH)}px ${String(8 + NODE_BORDER_WIDTH)}px 6px ${String(8 + NODE_BORDER_WIDTH)}px`
      : `6px ${String(8 + NODE_BORDER_WIDTH)}px`,
    margin: roundTop
      ? `-${String(NODE_BORDER_WIDTH)}px -${String(NODE_BORDER_WIDTH)}px 0`
      : `0 -${String(NODE_BORDER_WIDTH)}px 0`,
    background: tagColor,
    color: "#ffffff",
    borderTopLeftRadius: roundTop ? NODE_OUTER_RADIUS : 0,
    borderTopRightRadius: roundTop ? NODE_OUTER_RADIUS : 0,
    ...(roundBottom
      ? { borderBottomLeftRadius: innerClip, borderBottomRightRadius: innerClip }
      : {}),
    boxSizing: "border-box",
  };
}

function nodeStyles(
  tag: NodeTag,
  selected: boolean,
  minWidth = 200,
  corners?: NodeCornerOptions,
): NotebookNodeStyles {
  const tagColor = TAG_HEADER_BG[tag];
  const clip = NODE_CLIP_RADIUS;
  const sharedWrapper: CSSProperties = {
    minWidth,
    borderRadius: NODE_OUTER_RADIUS,
    border: `${String(NODE_BORDER_WIDTH)}px solid ${tagColor}`,
    background: tagColor,
    color: NODE_FOREGROUND,
    fontFamily: NODE_FONT_FAMILY,
    fontSize: 14,
    lineHeight: 1.4,
    outline: selected ? `2px solid ${NODE_SELECTION_OUTLINE}` : "none",
    outlineOffset: selected ? 3 : 0,
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.14)",
    overflow: "visible",
    boxSizing: "border-box",
  };

  if (corners?.layout === "stacked") {
    return {
      wrapper: sharedWrapper,
      header: headerStyle(
        tagColor,
        {
          roundTop: corners.roundHeaderTop,
          roundBottom: corners.roundHeaderBottom,
        },
        clip,
      ),
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
        flexShrink: 0,
        boxSizing: "border-box",
      },
      meta: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "6px 8px",
        fontSize: 12,
        color: NODE_MUTED,
        background: NODE_BACKGROUND,
        boxSizing: "border-box",
        ...(corners.roundMetaBottom
          ? { borderBottomLeftRadius: clip, borderBottomRightRadius: clip }
          : {}),
      },
      emptyState: {
        fontStyle: "italic",
        opacity: 0.78,
      },
      duration: {
        fontSize: 10,
        color: "rgba(255, 255, 255, 0.82)",
        fontVariantNumeric: "tabular-nums",
        flexShrink: 0,
      },
      // Delta chrome recedes behind the value it annotates: same colour
      // token as the duration, just dialled back. No new palette entries.
      durationDelta: {
        fontSize: 10,
        color: "rgba(255, 255, 255, 0.82)",
        opacity: 0.8,
        fontVariantNumeric: "tabular-nums",
        flexShrink: 0,
      },
      rowsDelta: {
        marginLeft: 4,
        color: NODE_MUTED,
        opacity: 0.85,
        fontVariantNumeric: "tabular-nums",
      },
    };
  }

  if (corners?.layout === "body") {
    return {
      wrapper: sharedWrapper,
      header: headerStyle(tagColor, { roundTop: true }, clip),
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
        flexShrink: 0,
        boxSizing: "border-box",
      },
      meta: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "6px 8px",
        fontSize: 12,
        color: NODE_MUTED,
        background: NODE_BACKGROUND,
        boxSizing: "border-box",
        ...(corners.roundMetaBottom
          ? { borderBottomLeftRadius: clip, borderBottomRightRadius: clip }
          : {}),
      },
      emptyState: {
        fontStyle: "italic",
        opacity: 0.78,
      },
      duration: {
        fontSize: 10,
        color: "rgba(255, 255, 255, 0.82)",
        fontVariantNumeric: "tabular-nums",
        flexShrink: 0,
      },
      // Delta chrome recedes behind the value it annotates: same colour
      // token as the duration, just dialled back. No new palette entries.
      durationDelta: {
        fontSize: 10,
        color: "rgba(255, 255, 255, 0.82)",
        opacity: 0.8,
        fontVariantNumeric: "tabular-nums",
        flexShrink: 0,
      },
      rowsDelta: {
        marginLeft: 4,
        color: NODE_MUTED,
        opacity: 0.85,
        fontVariantNumeric: "tabular-nums",
      },
    };
  }

  return {
    wrapper: {
      minWidth,
      borderRadius: NODE_OUTER_RADIUS,
      border: `${String(NODE_BORDER_WIDTH)}px solid ${tagColor}`,
      background: tagColor,
      color: NODE_FOREGROUND,
      fontFamily: NODE_FONT_FAMILY,
      fontSize: 14,
      lineHeight: 1.4,
      outline: selected ? `2px solid ${NODE_SELECTION_OUTLINE}` : "none",
      outlineOffset: selected ? 3 : 0,
      boxShadow: "0 1px 2px rgba(15, 23, 42, 0.14)",
      // Visible so an open port dropdown can float past the node edges.
      overflow: "visible",
      boxSizing: "border-box",
    },
    header: headerStyle(tagColor, { roundTop: true }, 6),
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
      background: NODE_BACKGROUND,
      boxSizing: "border-box",
    },
    emptyState: {
      fontStyle: "italic",
      opacity: 0.78,
    },
    duration: {
      fontSize: 10,
      color: "rgba(255, 255, 255, 0.82)",
      fontVariantNumeric: "tabular-nums",
      flexShrink: 0,
    },
    // Delta chrome recedes behind the value it annotates: same colour
    // token as the duration, just dialled back. No new palette entries.
    durationDelta: {
      fontSize: 10,
      color: "rgba(255, 255, 255, 0.82)",
      opacity: 0.8,
      fontVariantNumeric: "tabular-nums",
      flexShrink: 0,
    },
    rowsDelta: {
      marginLeft: 4,
      color: NODE_MUTED,
      opacity: 0.85,
      fontVariantNumeric: "tabular-nums",
    },
  };
}
