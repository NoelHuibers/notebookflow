/**
 * PortEditor — inline editor for a node's input or output ports.
 *
 * Each declared port is shown as a chip. Clicking a chip opens an
 * autocomplete combobox prefilled with its current value so it can be
 * changed; the small remove button drops it. A trailing "+" button opens an
 * empty combobox to declare a new port. The combobox lets the user type a
 * variable name freely while surfacing matching suggestions, so wiring can be
 * authored without leaving the canvas.
 *
 * Inputs are `nodeName.portName` refs (they point at an upstream output).
 * Outputs are bare `portName` names. Validation mirrors the marker grammar so
 * only values the parser accepts can be committed.
 *
 * Styling is explicit inline so the editor stays host-neutral, matching the
 * rest of the shared node surface.
 */

import { Plus, X } from "lucide-react";
import type { CSSProperties, KeyboardEvent, ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

const NODE_MUTED = "var(--notebookflow-node-muted, var(--muted-foreground, #6b7280))";
const NODE_BORDER = "var(--notebookflow-node-border, var(--border, #d1d5db))";
const NODE_BACKGROUND = "var(--notebookflow-node-bg, var(--card, #ffffff))";
const NODE_FOREGROUND = "var(--notebookflow-node-fg, var(--card-foreground, #111827))";

const NAME_RE = /^[A-Za-z0-9 _-]+$/;
const PORT_RE = /^[a-z][a-z0-9_]*$/;

export type PortKind = "input" | "output";

export interface PortEditorProps {
  kind: PortKind;
  ports: string[];
  suggestions: string[];
  onChange: (nextPorts: string[]) => void;
}

/** Validate a candidate value for the given port kind. */
function isValidPort(kind: PortKind, value: string): boolean {
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

export function PortEditor(props: PortEditorProps): ReactElement {
  const { kind, ports, suggestions, onChange } = props;
  // null = closed, -1 = adding a new port, >=0 = editing an existing index.
  const [editing, setEditing] = useState<number | null>(null);
  const label = kind === "input" ? "in" : "out";

  const commit = (index: number, value: string): void => {
    const trimmed = value.trim();
    setEditing(null);
    if (!isValidPort(kind, trimmed)) {
      return;
    }
    const next = ports.slice();
    if (index === -1) {
      if (next.includes(trimmed)) {
        return;
      }
      next.push(trimmed);
    } else {
      if (next.some((p, i) => p === trimmed && i !== index)) {
        // Collapsing onto an existing port: drop the duplicate.
        next.splice(index, 1);
      } else {
        next[index] = trimmed;
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
          <span key={`chip-${port}`} style={{ ...styles.chip, opacity: editing === idx ? 0.4 : 1 }}>
            <button
              type="button"
              className="nodrag nopan"
              title="Click to edit"
              onClick={() => {
                setEditing(idx);
              }}
              style={styles.chipLabel}
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
              style={styles.chipRemove}
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
          onClick={() => {
            setEditing(-1);
          }}
          style={styles.addButton}
        >
          <Plus aria-hidden="true" size={12} strokeWidth={2.5} />
        </button>
      </div>
      {editing !== null && (
        <div style={styles.floatLayer}>
          <PortCombobox
            key={editing === -1 ? "add" : `edit-${String(editing)}`}
            kind={kind}
            initialValue={editing === -1 ? "" : (ports[editing] ?? "")}
            suggestions={suggestions}
            onCommit={(value) => {
              commit(editing, value);
            }}
            onCancel={() => {
              setEditing(null);
            }}
          />
        </div>
      )}
    </div>
  );
}

interface PortComboboxProps {
  kind: PortKind;
  initialValue: string;
  suggestions: string[];
  onCommit: (value: string) => void;
  onCancel: () => void;
}

function PortCombobox(props: PortComboboxProps): ReactElement {
  const { kind, initialValue, suggestions, onCommit, onCancel } = props;
  const [query, setQuery] = useState(initialValue);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = suggestions.filter((s) => s !== initialValue);
    if (needle === "") {
      return pool.slice(0, 8);
    }
    return pool.filter((s) => s.toLowerCase().includes(needle)).slice(0, 8);
  }, [query, suggestions, initialValue]);

  const trimmed = query.trim();
  const canCreate = isValidPort(kind, trimmed) && !suggestions.includes(trimmed);
  const options = canCreate ? [trimmed, ...filtered] : filtered;

  const finish = (value: string): void => {
    committedRef.current = true;
    onCommit(value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      const choice = options[highlight] ?? trimmed;
      finish(choice);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      committedRef.current = true;
      onCancel();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => (options.length === 0 ? 0 : (h + 1) % options.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => (options.length === 0 ? 0 : (h - 1 + options.length) % options.length));
    }
  };

  const placeholder = kind === "input" ? "node.port" : "variable";

  return (
    <span style={styles.combobox} className="nodrag nopan">
      <input
        ref={inputRef}
        aria-label={kind === "input" ? "Input ref" : "Output variable"}
        className="nodrag nopan"
        value={query}
        placeholder={placeholder}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Allow a click on an option to commit before blur tears it down.
          window.setTimeout(() => {
            if (!committedRef.current) {
              onCancel();
            }
          }, 120);
        }}
        style={styles.comboInput}
      />
      {options.length > 0 && (
        <ul style={styles.comboList}>
          {options.map((option, idx) => {
            const isCreate = canCreate && idx === 0;
            return (
              <li key={option}>
                <button
                  type="button"
                  className="nodrag nopan"
                  onMouseDown={(event) => {
                    // Prevent input blur from firing before the click commits.
                    event.preventDefault();
                  }}
                  onClick={() => {
                    finish(option);
                  }}
                  style={{
                    ...styles.comboOption,
                    background: idx === highlight ? "rgba(99, 102, 241, 0.16)" : "transparent",
                  }}
                >
                  {isCreate ? `Use "${option}"` : option}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </span>
  );
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
    maxWidth: 140,
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
  floatLayer: {
    position: "absolute",
    top: "100%",
    left: 0,
    marginTop: 2,
    zIndex: 30,
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
    zIndex: 20,
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
} satisfies Record<string, CSSProperties>;
