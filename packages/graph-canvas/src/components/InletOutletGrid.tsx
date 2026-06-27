/**
 * InletOutletGrid — two-column port layout for a notebook node.
 *
 * Inlets (inputs) align left, outlets (outputs) align right. Each declared
 * port occupies one row so React Flow handles sit on the matching inlet or
 * outlet instead of being distributed along the node edge. Wires therefore
 * connect outlet → inlet rather than cell → cell.
 */

import { Plus, X } from "lucide-react";
import type { CSSProperties, ReactElement } from "react";
import { useState } from "react";
import { Handle, Position } from "reactflow";

import type { NodeTag } from "../types";
import { PortComboboxFloating } from "./PortComboboxFloating";
import {
  INLET_DROP_HANDLE_ID,
  isValidPort,
  NODE_BORDER,
  NODE_MUTED,
  type PortKind,
  portChipStyles,
} from "./portEditorShared";

const TAG_HANDLE_COLOR: Record<NodeTag, string> = {
  input: "#3b82f6",
  transform: "#10b981",
  output: "#ef4444",
  ai: "#a855f7",
  io: "#f97316",
};

const NODE_BACKGROUND = "var(--notebookflow-node-bg, var(--card, #ffffff))";

interface EditingTarget {
  kind: PortKind;
  index: number;
  anchorEl: HTMLElement;
}

export interface InletOutletGridProps {
  tag: NodeTag;
  inputs: string[];
  outputs: string[];
  showInlets: boolean;
  showOutlets: boolean;
  editable: boolean;
  inputSuggestions: string[];
  outputSuggestions: string[];
  onInputsChange?: (nextInputs: string[]) => void;
  onOutputsChange?: (nextOutputs: string[]) => void;
}

export function InletOutletGrid(props: InletOutletGridProps): ReactElement | null {
  const {
    tag,
    inputs,
    outputs,
    showInlets,
    showOutlets,
    editable,
    inputSuggestions,
    outputSuggestions,
    onInputsChange,
    onOutputsChange,
  } = props;

  const [editing, setEditing] = useState<EditingTarget | null>(null);

  if (!showInlets && !showOutlets) {
    return null;
  }

  const inletRows = inputs.length;
  const outletRows = outputs.length;
  const dropInletRow = editable && showInlets && onInputsChange !== undefined;
  const addOutletRow = editable && showOutlets && onOutputsChange !== undefined;
  const rowCount = Math.max(
    showInlets ? inletRows + (dropInletRow ? 1 : 0) : 0,
    showOutlets ? outletRows + (addOutletRow ? 1 : 0) : 0,
    1,
  );
  const gridColumns = showInlets && showOutlets ? "1fr 1fr" : showInlets ? "1fr" : "1fr";

  const commit = (kind: PortKind, index: number, value: string): void => {
    const trimmed = value.trim();
    setEditing(null);
    if (!isValidPort(kind, trimmed)) {
      return;
    }
    if (kind === "input") {
      if (onInputsChange === undefined) {
        return;
      }
      const next = inputs.slice();
      if (index === -1) {
        if (next.includes(trimmed)) {
          return;
        }
        next.push(trimmed);
      } else {
        if (next.some((p, i) => p === trimmed && i !== index)) {
          next.splice(index, 1);
        } else {
          next[index] = trimmed;
        }
      }
      onInputsChange(next);
      return;
    }
    if (onOutputsChange === undefined) {
      return;
    }
    const next = outputs.slice();
    if (index === -1) {
      if (next.includes(trimmed)) {
        return;
      }
      next.push(trimmed);
    } else {
      if (next.some((p, i) => p === trimmed && i !== index)) {
        next.splice(index, 1);
      } else {
        next[index] = trimmed;
      }
    }
    onOutputsChange(next);
  };

  const remove = (kind: PortKind, index: number): void => {
    setEditing(null);
    if (kind === "input") {
      if (onInputsChange === undefined) {
        return;
      }
      const next = inputs.slice();
      next.splice(index, 1);
      onInputsChange(next);
      return;
    }
    if (onOutputsChange === undefined) {
      return;
    }
    const next = outputs.slice();
    next.splice(index, 1);
    onOutputsChange(next);
  };

  const handleColor = TAG_HANDLE_COLOR[tag];

  return (
    <div style={styles.grid}>
      <div style={{ ...styles.headerRow, gridTemplateColumns: gridColumns }}>
        {showInlets && <span style={{ ...styles.headerCell, textAlign: "left" }}>Input</span>}
        {showOutlets && <span style={{ ...styles.headerCell, textAlign: "right" }}>Output</span>}
      </div>
      {Array.from({ length: rowCount }, (_, rowIdx) => {
        const inlet = showInlets ? inputs[rowIdx] : undefined;
        const outlet = showOutlets ? outputs[rowIdx] : undefined;
        const isDropInletRow = dropInletRow && rowIdx === inletRows && inlet === undefined;
        const isAddOutletRow = addOutletRow && rowIdx === outletRows && outlet === undefined;

        if (inlet === undefined && outlet === undefined && !isDropInletRow && !isAddOutletRow) {
          return null;
        }

        return (
          <div
            key={`port-row-${String(rowIdx)}`}
            style={{ ...styles.bodyRow, gridTemplateColumns: gridColumns }}
          >
            {showInlets && (
              <div style={styles.inletCell}>
                {isDropInletRow ? (
                  <>
                    <Handle
                      id={INLET_DROP_HANDLE_ID}
                      type="target"
                      position={Position.Left}
                      style={handleStyle(handleColor, "left")}
                    />
                    {editable ? (
                      <button
                        type="button"
                        className="nodrag nopan"
                        aria-label="Add input"
                        title="Add input"
                        onClick={(event) => {
                          setEditing({ kind: "input", index: -1, anchorEl: event.currentTarget });
                        }}
                        style={styles.dropHint}
                      >
                        <Plus aria-hidden="true" size={11} strokeWidth={2.5} />
                        <span>wire or add</span>
                      </button>
                    ) : (
                      <span style={styles.emptySlot}>—</span>
                    )}
                  </>
                ) : inlet !== undefined ? (
                  <>
                    <Handle
                      id={inlet}
                      type="target"
                      position={Position.Left}
                      style={handleStyle(handleColor, "left")}
                    />
                    {editable && onInputsChange !== undefined ? (
                      <PortChip
                        value={inlet}
                        dimmed={editing?.kind === "input" && editing.index === rowIdx}
                        onEdit={(anchorEl) => {
                          setEditing({ kind: "input", index: rowIdx, anchorEl });
                        }}
                        onRemove={() => {
                          remove("input", rowIdx);
                        }}
                      />
                    ) : (
                      <span style={styles.readOnlyPort}>{inlet}</span>
                    )}
                  </>
                ) : (
                  <span style={styles.emptySlot} />
                )}
              </div>
            )}
            {showOutlets && (
              <div style={styles.outletCell}>
                {isAddOutletRow ? (
                  editable ? (
                    <button
                      type="button"
                      className="nodrag nopan"
                      aria-label="Add output"
                      title="Add output"
                      onClick={(event) => {
                        setEditing({ kind: "output", index: -1, anchorEl: event.currentTarget });
                      }}
                      style={{ ...portChipStyles.addButton, marginLeft: "auto" }}
                    >
                      <Plus aria-hidden="true" size={11} strokeWidth={2.5} />
                    </button>
                  ) : (
                    <span style={styles.emptySlot}>—</span>
                  )
                ) : outlet !== undefined ? (
                  <>
                    {editable && onOutputsChange !== undefined ? (
                      <PortChip
                        value={outlet}
                        dimmed={editing?.kind === "output" && editing.index === rowIdx}
                        onEdit={(anchorEl) => {
                          setEditing({ kind: "output", index: rowIdx, anchorEl });
                        }}
                        onRemove={() => {
                          remove("output", rowIdx);
                        }}
                      />
                    ) : (
                      <span style={styles.readOnlyPort}>{outlet}</span>
                    )}
                    <Handle
                      id={outlet}
                      type="source"
                      position={Position.Right}
                      style={handleStyle(handleColor, "right")}
                    />
                  </>
                ) : (
                  <span style={styles.emptySlot} />
                )}
              </div>
            )}
          </div>
        );
      })}
      {editing !== null && (
        <PortComboboxFloating
          key={
            editing.index === -1
              ? `add-${editing.kind}`
              : `edit-${editing.kind}-${String(editing.index)}`
          }
          anchorEl={editing.anchorEl}
          kind={editing.kind}
          initialValue={
            editing.index === -1
              ? ""
              : editing.kind === "input"
                ? (inputs[editing.index] ?? "")
                : (outputs[editing.index] ?? "")
          }
          suggestions={editing.kind === "input" ? inputSuggestions : outputSuggestions}
          onCommit={(value) => {
            commit(editing.kind, editing.index, value);
          }}
          onCancel={() => {
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

interface PortChipProps {
  value: string;
  dimmed: boolean;
  onEdit: (anchorEl: HTMLElement) => void;
  onRemove: () => void;
}

function PortChip(props: PortChipProps): ReactElement {
  const { value, dimmed, onEdit, onRemove } = props;
  return (
    <span style={{ ...portChipStyles.chip, opacity: dimmed ? 0.4 : 1 }}>
      <button
        type="button"
        className="nodrag nopan"
        title="Click to edit"
        onClick={(event) => {
          onEdit(event.currentTarget);
        }}
        style={portChipStyles.chipLabel}
      >
        {value}
      </button>
      <button
        type="button"
        className="nodrag nopan"
        aria-label={`Remove ${value}`}
        title={`Remove ${value}`}
        onClick={onRemove}
        style={portChipStyles.chipRemove}
      >
        <X aria-hidden="true" size={10} strokeWidth={2.5} />
      </button>
    </span>
  );
}

function handleStyle(color: string, side: "left" | "right"): CSSProperties {
  return {
    position: "absolute",
    top: "50%",
    ...(side === "left" ? { left: -6 } : { right: -6 }),
    transform: "translateY(-50%)",
    width: 10,
    height: 10,
    borderRadius: 999,
    border: `2px solid ${NODE_BACKGROUND}`,
    background: color,
    boxSizing: "border-box",
  };
}

const styles = {
  grid: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    boxSizing: "border-box",
  },
  headerRow: {
    display: "grid",
    gap: 8,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: NODE_MUTED,
    paddingBottom: 2,
    borderBottom: `1px solid ${NODE_BORDER}`,
  },
  headerCell: {
    minWidth: 0,
  },
  bodyRow: {
    display: "grid",
    gap: 8,
    alignItems: "center",
    minHeight: 26,
  },
  inletCell: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    minWidth: 0,
    paddingLeft: 6,
  },
  outletCell: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    minWidth: 0,
    paddingRight: 6,
  },
  readOnlyPort: {
    fontSize: 12,
    lineHeight: 1.4,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "100%",
  },
  emptySlot: {
    display: "block",
    minHeight: 20,
  },
  dropHint: {
    appearance: "none",
    border: `1px dashed ${NODE_BORDER}`,
    borderRadius: 6,
    background: "transparent",
    color: NODE_MUTED,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    font: "inherit",
    fontSize: 11,
    lineHeight: 1.3,
    padding: "2px 6px",
    cursor: "pointer",
  },
} satisfies Record<string, CSSProperties>;
