/**
 * InletOutletGrid — port layout for a notebook node.
 *
 * **Sides** (dagre / horizontal flow): inputs left, outputs right, one row per
 * port pair. **Stacked** (manual / vertical flow): all handles on one horizontal
 * rail at the top (inputs) or bottom (outputs); port labels sit in the adjacent
 * row, each centered under its connector.
 */

import { Plus, X } from "lucide-react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useState } from "react";
import { Handle, Position } from "reactflow";

import { useCanvasLabels } from "../labels";
import { formatInputBinding, formatRef, parseInputBinding, parseRef } from "../sync/MarkerParser";
import type { NodeTag } from "../types";
import { PortComboboxFloating } from "./PortComboboxFloating";
import {
  displayInputPortName,
  INLET_DROP_HANDLE_ID,
  isValidPort,
  NODE_BACKGROUND,
  NODE_BORDER,
  NODE_MUTED,
  PORT_EDGE_INSET,
  type PortKind,
  portChipStyles,
  STACKED_CHIP_MIN_WIDTH,
} from "./portEditorShared";

const TAG_HANDLE_COLOR: Record<NodeTag, string> = {
  input: "#3b82f6",
  transform: "#10b981",
  output: "#ef4444",
  ai: "#a855f7",
  io: "#f97316",
};

/** Matches the inner curve of the 8px node wrapper (8px radius − 2px border). */
export const NODE_CLIP_RADIUS = 6;

const HANDLE_RAIL_SIZE = 10;

/** Side handles straddle the port row edge; stacked handles sit slightly inside the band. */
const SIDE_HANDLE_EDGE_OFFSET = -PORT_EDGE_INSET;
const STACKED_HANDLE_INSET = 2;

export type PortPlacement = "sides" | "stacked";
export type PortEdge = "top" | "bottom";

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
  /** Side-by-side (horizontal flow) or stacked top/bottom (vertical flow). */
  placement?: PortPlacement;
  /** Which edge to render when `placement` is `"stacked"` or `"sides"`. */
  edge?: PortEdge;
  /** Round outer corners to match the node wrapper. */
  clipCorner?: "top" | "bottom";
  onInputsChange?: (nextInputs: string[]) => void;
  onOutputsChange?: (nextOutputs: string[]) => void;
}

export function InletOutletGrid(props: InletOutletGridProps): ReactElement | null {
  const placement = props.placement ?? "sides";
  if (placement === "stacked") {
    return <StackedPortSection {...props} />;
  }
  return <SidePortGrid {...props} />;
}

/** Whether the left / top inlet port band renders. */
export function inletPortsVisible(
  showInlets: boolean,
  inputs: string[],
  editable: boolean,
  canChangeInputs: boolean,
): boolean {
  if (!showInlets) {
    return false;
  }
  return inputs.length > 0 || (editable && canChangeInputs);
}

/** Whether the right / bottom outlet port band renders. */
export function outletPortsVisible(
  showOutlets: boolean,
  outputs: string[],
  editable: boolean,
  canChangeOutputs: boolean,
): boolean {
  if (!showOutlets) {
    return false;
  }
  return outputs.length > 0 || (editable && canChangeOutputs);
}

function clipSectionStyle(
  base: CSSProperties,
  clipCorner: "top" | "bottom" | undefined,
): CSSProperties {
  if (clipCorner === "top") {
    return {
      ...base,
      borderTopLeftRadius: NODE_CLIP_RADIUS,
      borderTopRightRadius: NODE_CLIP_RADIUS,
    };
  }
  if (clipCorner === "bottom") {
    return {
      ...base,
      borderBottomLeftRadius: NODE_CLIP_RADIUS,
      borderBottomRightRadius: NODE_CLIP_RADIUS,
    };
  }
  return base;
}

function SidePortGrid(props: InletOutletGridProps): ReactElement | null {
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

  const labels = useCanvasLabels();
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
  const gridColumns = showInlets && showOutlets ? "1fr 1fr" : "1fr";

  const { commit, remove } = createPortEditorActions(
    inputs,
    outputs,
    onInputsChange,
    onOutputsChange,
    setEditing,
  );

  const handleColor = TAG_HANDLE_COLOR[tag];

  return (
    <div style={sideGridStyles.grid}>
      <div style={{ ...sideGridStyles.headerRow, gridTemplateColumns: gridColumns }}>
        {showInlets && (
          <span style={{ ...sideGridStyles.headerCell, textAlign: "left" }}>
            {labels.portInput}
          </span>
        )}
        {showOutlets && (
          <span style={{ ...sideGridStyles.headerCell, textAlign: "right" }}>
            {labels.portOutput}
          </span>
        )}
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
            style={{ ...sideGridStyles.bodyRow, gridTemplateColumns: gridColumns }}
          >
            {showInlets && (
              <div style={sideGridStyles.inletCell}>
                {isDropInletRow ? (
                  <>
                    <Handle
                      id={INLET_DROP_HANDLE_ID}
                      type="target"
                      position={Position.Left}
                      style={sideHandleStyle(handleColor, "left")}
                    />
                    {editable ? (
                      <button
                        type="button"
                        className="nodrag nopan"
                        aria-label={labels.addInput}
                        title={labels.addInput}
                        onClick={(event) => {
                          setEditing({ kind: "input", index: -1, anchorEl: event.currentTarget });
                        }}
                        style={sideGridStyles.dropHint}
                      >
                        <Plus aria-hidden="true" size={11} strokeWidth={2.5} />
                        <span>wire or add</span>
                      </button>
                    ) : (
                      <span style={sideGridStyles.emptySlot}>—</span>
                    )}
                  </>
                ) : inlet !== undefined ? (
                  <>
                    <Handle
                      id={inlet}
                      type="target"
                      position={Position.Left}
                      style={sideHandleStyle(handleColor, "left")}
                    />
                    {editable && onInputsChange !== undefined ? (
                      <PortChip
                        kind="input"
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
                      <span style={portChipStyles.readOnlyPort} title={inlet}>
                        <InputPortLabel value={inlet} />
                      </span>
                    )}
                  </>
                ) : (
                  <span style={sideGridStyles.emptySlot} />
                )}
              </div>
            )}
            {showOutlets && (
              <div style={sideGridStyles.outletCell}>
                {isAddOutletRow ? (
                  editable ? (
                    <button
                      type="button"
                      className="nodrag nopan"
                      aria-label={labels.addOutput}
                      title={labels.addOutput}
                      onClick={(event) => {
                        setEditing({ kind: "output", index: -1, anchorEl: event.currentTarget });
                      }}
                      style={{ ...portChipStyles.addButton, marginLeft: "auto" }}
                    >
                      <Plus aria-hidden="true" size={11} strokeWidth={2.5} />
                    </button>
                  ) : (
                    <span style={sideGridStyles.emptySlot}>—</span>
                  )
                ) : outlet !== undefined ? (
                  <>
                    {editable && onOutputsChange !== undefined ? (
                      <PortChip
                        kind="output"
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
                      <span style={portChipStyles.readOnlyPortSideRight}>{outlet}</span>
                    )}
                    <Handle
                      id={outlet}
                      type="source"
                      position={Position.Right}
                      style={sideHandleStyle(handleColor, "right")}
                    />
                  </>
                ) : (
                  <span style={sideGridStyles.emptySlot} />
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
                ? inputEditorValue(inputs[editing.index])
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

function StackedPortCell(props: { children: ReactNode }): ReactElement {
  return <div style={stackedStyles.portColumnContent}>{props.children}</div>;
}

function StackedPortWidthKeeper({
  kind,
  value,
  editable,
}: {
  kind: PortKind;
  value: string | null;
  editable: boolean;
}): ReactElement {
  let content: ReactNode;
  if (value === null) {
    content =
      kind === "input" ? (
        <span style={stackedStyles.dropHint}>
          <Plus aria-hidden="true" size={11} strokeWidth={2.5} />
          <span>wire or add</span>
        </span>
      ) : (
        <span style={portChipStyles.addButton}>
          <Plus aria-hidden="true" size={11} strokeWidth={2.5} />
        </span>
      );
  } else if (editable) {
    content = (
      <SidePortLabel
        kind={kind}
        value={value}
        dimmed={false}
        onEdit={() => undefined}
        onRemove={() => undefined}
      />
    );
  } else {
    content =
      kind === "input" ? (
        <span style={portChipStyles.readOnlyPort}>
          <InputPortLabel value={value} />
        </span>
      ) : (
        <span style={portChipStyles.readOnlyPort}>{value}</span>
      );
  }

  return (
    <div
      aria-hidden="true"
      data-testid="stacked-port-width-keeper"
      style={stackedStyles.widthKeeper}
    >
      {content}
    </div>
  );
}

/** Center the lone drop/add affordance when no ports exist yet. */
function stackedPortRowStyles(
  columns: ReadonlyArray<{ port: string | null }>,
  baseRow: CSSProperties,
): { row: CSSProperties; column: CSSProperties } {
  const centerPlaceholder = columns.length === 1 && columns[0]?.port === null;
  if (!centerPlaceholder) {
    return { row: baseRow, column: stackedStyles.portColumn };
  }
  return {
    row: { ...baseRow, justifyContent: "center" },
    column: stackedStyles.portColumnCentered,
  };
}

function StackedPortSection(props: InletOutletGridProps): ReactElement | null {
  const {
    tag,
    inputs,
    outputs,
    showInlets,
    showOutlets,
    editable,
    inputSuggestions,
    outputSuggestions,
    edge,
    clipCorner,
    onInputsChange,
    onOutputsChange,
  } = props;

  const labels = useCanvasLabels();
  const [editing, setEditing] = useState<EditingTarget | null>(null);
  const isTop = edge === "top";
  const isBottom = edge === "bottom";

  if (isTop && !showInlets) {
    return null;
  }
  if (isBottom && !showOutlets) {
    return null;
  }
  if (!isTop && !isBottom) {
    return null;
  }

  const handleColor = TAG_HANDLE_COLOR[tag];
  const { commit, remove } = createPortEditorActions(
    inputs,
    outputs,
    onInputsChange,
    onOutputsChange,
    setEditing,
  );

  if (isTop) {
    const dropInlet = editable && onInputsChange !== undefined;
    if (inputs.length === 0 && !dropInlet) {
      return null;
    }

    type InletColumn = { key: string; port: string | null; index: number };
    const columns: InletColumn[] = inputs.map((port, index) => ({
      key: port,
      port,
      index,
    }));
    if (dropInlet) {
      columns.push({ key: INLET_DROP_HANDLE_ID, port: null, index: -1 });
    }

    const { row: handleRowStyle, column: portColumnStyle } = stackedPortRowStyles(
      columns,
      stackedStyles.handleRailTop,
    );
    const { row: labelRowStyle } = stackedPortRowStyles(
      columns,
      stackedStyles.labelRowBelowHandles,
    );

    return (
      <div style={clipSectionStyle(stackedStyles.sectionTop, clipCorner)}>
        <div style={handleRowStyle} data-testid="handle-rail-top">
          {columns.map((col) => (
            <div key={col.key} style={portColumnStyle}>
              <Handle
                id={col.key}
                type="target"
                position={Position.Top}
                style={stackedHandleStyle(handleColor, "top")}
              />
              <StackedPortWidthKeeper
                kind="input"
                value={col.port}
                editable={editable && onInputsChange !== undefined}
              />
            </div>
          ))}
        </div>
        <div style={labelRowStyle}>
          {columns.map((col) => (
            <div key={`label-${col.key}`} style={portColumnStyle}>
              <StackedPortCell>
                {col.port === null ? (
                  editable ? (
                    <button
                      type="button"
                      className="nodrag nopan"
                      aria-label={labels.addInput}
                      title={labels.addInput}
                      onClick={(event) => {
                        setEditing({ kind: "input", index: -1, anchorEl: event.currentTarget });
                      }}
                      style={stackedStyles.dropHint}
                    >
                      <Plus aria-hidden="true" size={11} strokeWidth={2.5} />
                      <span>wire or add</span>
                    </button>
                  ) : (
                    <span style={stackedStyles.emptySlot}>—</span>
                  )
                ) : editable && onInputsChange !== undefined ? (
                  <PortChip
                    kind="input"
                    value={col.port}
                    dimmed={editing?.kind === "input" && editing.index === col.index}
                    onEdit={(anchorEl) => {
                      setEditing({ kind: "input", index: col.index, anchorEl });
                    }}
                    onRemove={() => {
                      remove("input", col.index);
                    }}
                  />
                ) : (
                  <span style={portChipStyles.readOnlyPort} title={col.port}>
                    <InputPortLabel value={col.port} />
                  </span>
                )}
              </StackedPortCell>
            </div>
          ))}
        </div>
        {editing !== null && editing.kind === "input" && (
          <PortComboboxFloating
            key={editing.index === -1 ? "add-input" : `edit-input-${String(editing.index)}`}
            anchorEl={editing.anchorEl}
            kind="input"
            initialValue={editing.index === -1 ? "" : inputEditorValue(inputs[editing.index])}
            suggestions={inputSuggestions}
            onCommit={(value) => {
              commit("input", editing.index, value);
            }}
            onCancel={() => {
              setEditing(null);
            }}
          />
        )}
      </div>
    );
  }

  const addOutlet = editable && onOutputsChange !== undefined;
  if (outputs.length === 0 && !addOutlet) {
    return null;
  }

  type OutletColumn = { key: string; port: string | null; index: number };
  const columns: OutletColumn[] = outputs.map((port, index) => ({
    key: port,
    port,
    index,
  }));
  if (addOutlet) {
    columns.push({ key: "__add_out__", port: null, index: -1 });
  }

  const { row: labelRowStyle, column: portColumnStyle } = stackedPortRowStyles(
    columns,
    stackedStyles.labelRowAboveHandles,
  );
  const { row: handleRowStyle } = stackedPortRowStyles(columns, stackedStyles.handleRailBottom);

  return (
    <div style={clipSectionStyle(stackedStyles.sectionBottom, clipCorner)}>
      <div style={labelRowStyle}>
        {columns.map((col) => (
          <div key={`label-${col.key}`} style={portColumnStyle}>
            <StackedPortCell>
              {col.port === null ? (
                editable ? (
                  <button
                    type="button"
                    className="nodrag nopan"
                    aria-label={labels.addOutput}
                    title={labels.addOutput}
                    onClick={(event) => {
                      setEditing({ kind: "output", index: -1, anchorEl: event.currentTarget });
                    }}
                    style={portChipStyles.addButton}
                  >
                    <Plus aria-hidden="true" size={11} strokeWidth={2.5} />
                  </button>
                ) : (
                  <span style={stackedStyles.emptySlot}>—</span>
                )
              ) : editable && onOutputsChange !== undefined ? (
                <PortChip
                  kind="output"
                  value={col.port}
                  dimmed={editing?.kind === "output" && editing.index === col.index}
                  onEdit={(anchorEl) => {
                    setEditing({ kind: "output", index: col.index, anchorEl });
                  }}
                  onRemove={() => {
                    remove("output", col.index);
                  }}
                />
              ) : (
                <span style={portChipStyles.readOnlyPort} title={col.port}>
                  {col.port}
                </span>
              )}
            </StackedPortCell>
          </div>
        ))}
      </div>
      <div style={handleRowStyle} data-testid="handle-rail-bottom">
        {columns.map((col) =>
          col.port === null ? (
            <div key={col.key} style={portColumnStyle}>
              <StackedPortWidthKeeper kind="output" value={null} editable={addOutlet} />
            </div>
          ) : (
            <div key={col.key} style={portColumnStyle}>
              <Handle
                id={col.port}
                type="source"
                position={Position.Bottom}
                style={stackedHandleStyle(handleColor, "bottom")}
              />
              <StackedPortWidthKeeper
                kind="output"
                value={col.port}
                editable={editable && onOutputsChange !== undefined}
              />
            </div>
          ),
        )}
      </div>
      {editing !== null && editing.kind === "output" && (
        <PortComboboxFloating
          key={editing.index === -1 ? "add-output" : `edit-output-${String(editing.index)}`}
          anchorEl={editing.anchorEl}
          kind="output"
          initialValue={editing.index === -1 ? "" : (outputs[editing.index] ?? "")}
          suggestions={outputSuggestions}
          onCommit={(value) => {
            commit("output", editing.index, value);
          }}
          onCancel={() => {
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function createPortEditorActions(
  inputs: string[],
  outputs: string[],
  onInputsChange: InletOutletGridProps["onInputsChange"],
  onOutputsChange: InletOutletGridProps["onOutputsChange"],
  setEditing: (target: EditingTarget | null) => void,
): {
  commit: (kind: PortKind, index: number, value: string) => void;
  remove: (kind: PortKind, index: number) => void;
} {
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
      const normalized = normalizeInputPortValue(trimmed, index === -1 ? undefined : inputs[index]);
      if (normalized === null) {
        return;
      }
      const next = inputs.slice();
      if (index === -1) {
        if (next.includes(normalized)) {
          return;
        }
        next.push(normalized);
      } else {
        if (next.some((p, i) => p === normalized && i !== index)) {
          next.splice(index, 1);
        } else {
          next[index] = normalized;
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

  return { commit, remove };
}

function normalizeInputPortValue(value: string, previousValue: string | undefined): string | null {
  const binding = parseInputBinding(value);
  if (binding !== null) {
    return formatInputBinding(binding);
  }
  const source = parseRef(value);
  if (source === null) {
    return null;
  }
  const previousBinding =
    previousValue === undefined ? null : parseInputBinding(previousValue.trim());
  return formatInputBinding({
    localName: previousBinding?.localName ?? source.portName,
    source,
  });
}

function inputEditorValue(value: string | undefined): string {
  if (value === undefined) {
    return "";
  }
  const binding = parseInputBinding(value.trim());
  return binding === null ? value : formatRef(binding.source);
}

interface PortChipProps {
  kind: PortKind;
  value: string;
  dimmed: boolean;
  onEdit: (anchorEl: HTMLElement) => void;
  onRemove: () => void;
}

function PortChip(props: PortChipProps): ReactElement {
  const { kind, value, dimmed, onEdit, onRemove } = props;
  return (
    <SidePortLabel kind={kind} value={value} dimmed={dimmed} onEdit={onEdit} onRemove={onRemove} />
  );
}

function SidePortLabel(props: PortChipProps): ReactElement {
  const { kind, value, dimmed, onEdit, onRemove } = props;
  return (
    <span style={{ ...portChipStyles.sidesChip, opacity: dimmed ? 0.4 : 1 }}>
      <span style={portChipStyles.sidesChipLabelRegion}>
        <button
          type="button"
          className="nodrag nopan"
          title={value}
          onClick={(event) => {
            onEdit(event.currentTarget);
          }}
          style={portChipStyles.chipLabel}
        >
          {kind === "input" ? <InputPortLabel value={value} /> : value}
        </button>
      </span>
      <span style={portChipStyles.sidesChipRemoveRegion}>
        <button
          type="button"
          className="nodrag nopan"
          aria-label={`Remove ${value}`}
          title={`Remove ${value}`}
          onClick={onRemove}
          style={portChipStyles.sidesChipRemove}
        >
          <X aria-hidden="true" size={10} strokeWidth={2.5} />
        </button>
      </span>
    </span>
  );
}

function InputPortLabel({ value }: { value: string }): ReactElement {
  const displayName = displayInputPortName(value);
  const dotIdx = value.lastIndexOf(".");
  if (displayName !== value || dotIdx <= 0 || dotIdx === value.length - 1) {
    return <span style={inputRefLabelStyles.label}>{displayName}</span>;
  }
  return (
    <span style={inputRefLabelStyles.label}>
      <span style={inputRefLabelStyles.prefix}>{value.slice(0, dotIdx + 1)}</span>
      <span style={inputRefLabelStyles.variable}>{value.slice(dotIdx + 1)}</span>
    </span>
  );
}

function sideHandleStyle(color: string, side: "left" | "right"): CSSProperties {
  return {
    position: "absolute",
    top: "50%",
    ...(side === "left" ? { left: SIDE_HANDLE_EDGE_OFFSET } : { right: SIDE_HANDLE_EDGE_OFFSET }),
    transform: "translateY(-50%)",
    width: 10,
    height: 10,
    borderRadius: 999,
    border: "none",
    background: color,
    boxSizing: "border-box",
  };
}

function stackedHandleStyle(color: string, edge: "top" | "bottom"): CSSProperties {
  return {
    position: "absolute",
    left: "50%",
    ...(edge === "top" ? { top: STACKED_HANDLE_INSET } : { bottom: STACKED_HANDLE_INSET }),
    transform: "translateX(-50%)",
    width: 10,
    height: 10,
    borderRadius: 999,
    border: "none",
    background: color,
    boxSizing: "border-box",
  };
}

const inputRefLabelStyles = {
  label: {
    display: "inline-flex",
    minWidth: "max-content",
    overflow: "visible",
    direction: "ltr",
    textAlign: "left",
    whiteSpace: "nowrap",
  },
  prefix: {
    overflow: "visible",
    textOverflow: "clip",
    color: NODE_MUTED,
    flexShrink: 0,
  },
  variable: {
    overflow: "visible",
    textOverflow: "clip",
    color: "inherit",
    flexShrink: 0,
  },
} satisfies Record<string, CSSProperties>;

const sideGridStyles = {
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
    paddingLeft: PORT_EDGE_INSET,
  },
  outletCell: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    minWidth: 0,
    paddingRight: PORT_EDGE_INSET,
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

const stackedPortRailInset: CSSProperties = {
  paddingInline: PORT_EDGE_INSET,
  boxSizing: "border-box",
};

const stackedStyles = {
  sectionTop: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    paddingBottom: PORT_EDGE_INSET,
    background: NODE_BACKGROUND,
    boxSizing: "border-box",
  },
  sectionBottom: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    paddingTop: PORT_EDGE_INSET,
    background: NODE_BACKGROUND,
    boxSizing: "border-box",
  },
  handleRailTop: {
    position: "relative",
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    minHeight: HANDLE_RAIL_SIZE,
    ...stackedPortRailInset,
  },
  handleRailBottom: {
    position: "relative",
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-end",
    minHeight: HANDLE_RAIL_SIZE,
    ...stackedPortRailInset,
  },
  labelRowBelowHandles: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    flexWrap: "nowrap",
    gap: 4,
    minHeight: 22,
    boxSizing: "border-box",
    ...stackedPortRailInset,
  },
  labelRowAboveHandles: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-end",
    flexWrap: "nowrap",
    gap: 4,
    minHeight: 22,
    boxSizing: "border-box",
    ...stackedPortRailInset,
  },
  portColumn: {
    position: "relative",
    flex: "0 0 auto",
    minWidth: STACKED_CHIP_MIN_WIDTH,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    minHeight: 0,
    boxSizing: "border-box",
  },
  portColumnCentered: {
    position: "relative",
    flex: "0 0 auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    minHeight: 0,
    boxSizing: "border-box",
  },
  portColumnContent: {
    width: "100%",
    minWidth: "max-content",
    display: "flex",
    justifyContent: "center",
    boxSizing: "border-box",
  },
  widthKeeper: {
    visibility: "hidden",
    pointerEvents: "none",
    height: 0,
    overflow: "hidden",
    display: "flex",
    justifyContent: "center",
  },
  emptySlot: {
    display: "block",
    minHeight: 18,
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
