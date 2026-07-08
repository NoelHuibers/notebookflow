/**
 * PortEditor — inline editor for a node's input or output ports.
 *
 * Kept for backwards compatibility where a flat chip list is still useful.
 * The canvas node surface uses InletOutletGrid instead.
 */

import { Plus, X } from "lucide-react";
import type { CSSProperties, ReactElement } from "react";
import { useState } from "react";

import { useCanvasLabels } from "../labels";
import { formatInputBinding, formatRef, parseInputBinding, parseRef } from "../sync/MarkerParser";
import { PortComboboxFloating } from "./PortComboboxFloating";
import { isValidPort, type PortKind, portChipStyles } from "./portEditorShared";

export type { PortKind };

export interface PortEditorProps {
  kind: PortKind;
  ports: string[];
  suggestions: string[];
  onChange: (nextPorts: string[]) => void;
}

interface EditingTarget {
  index: number;
  anchorEl: HTMLElement;
}

export function PortEditor(props: PortEditorProps): ReactElement {
  const { kind, ports, suggestions, onChange } = props;
  const labels = useCanvasLabels();
  const [editing, setEditing] = useState<EditingTarget | null>(null);
  const label = kind === "input" ? "in" : "out";

  const commit = (index: number, value: string): void => {
    const trimmed = value.trim();
    setEditing(null);
    if (!isValidPort(kind, trimmed)) {
      return;
    }
    const normalized =
      kind === "input"
        ? normalizeInputPortValue(trimmed, index === -1 ? undefined : ports[index])
        : trimmed;
    if (normalized === null) {
      return;
    }
    const next = ports.slice();
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
    onChange(next);
  };

  const remove = (index: number): void => {
    const next = ports.slice();
    next.splice(index, 1);
    setEditing(null);
    onChange(next);
  };

  return (
    <div style={styles.row}>
      <strong style={styles.label}>{label}:</strong>
      <div style={styles.chips}>
        {ports.map((port, idx) => (
          <span
            key={`chip-${port}`}
            style={{ ...portChipStyles.chip, opacity: editing?.index === idx ? 0.4 : 1 }}
          >
            <button
              type="button"
              className="nodrag nopan"
              title={labels.portClickToEdit}
              onClick={(event) => {
                setEditing({ index: idx, anchorEl: event.currentTarget });
              }}
              style={portChipStyles.chipLabel}
            >
              {port}
            </button>
            <button
              type="button"
              className="nodrag nopan"
              aria-label={`Remove ${port}`}
              title={`Remove ${port}`}
              onClick={() => {
                remove(idx);
              }}
              style={portChipStyles.chipRemove}
            >
              <X aria-hidden="true" size={10} strokeWidth={2.5} />
            </button>
          </span>
        ))}
        <button
          type="button"
          className="nodrag nopan"
          aria-label={`Add ${kind}`}
          title={`Add ${kind}`}
          onClick={(event) => {
            setEditing({ index: -1, anchorEl: event.currentTarget });
          }}
          style={portChipStyles.addButton}
        >
          <Plus aria-hidden="true" size={12} strokeWidth={2.5} />
        </button>
      </div>
      {editing !== null && (
        <PortComboboxFloating
          key={editing.index === -1 ? "add" : `edit-${String(editing.index)}`}
          anchorEl={editing.anchorEl}
          kind={kind}
          initialValue={
            editing.index === -1
              ? ""
              : kind === "input"
                ? inputEditorValue(ports[editing.index])
                : (ports[editing.index] ?? "")
          }
          suggestions={suggestions}
          onCommit={(value) => {
            commit(editing.index, value);
          }}
          onCancel={() => {
            setEditing(null);
          }}
        />
      )}
    </div>
  );
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

const styles = {
  row: {
    position: "relative",
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
  },
  label: {
    paddingTop: 3,
    flexShrink: 0,
  },
  chips: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
  },
} satisfies Record<string, CSSProperties>;
