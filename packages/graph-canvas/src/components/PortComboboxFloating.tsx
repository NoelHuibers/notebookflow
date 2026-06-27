/**
 * PortComboboxFloating — port editor combobox rendered in a body portal.
 *
 * React Flow stacks sibling nodes by paint order, so an absolutely positioned
 * dropdown inside a node gets clipped/covered by cells below. Portaling to
 * document.body with a fixed anchor keeps the suggestion list on top.
 */

import type { CSSProperties, KeyboardEvent, ReactElement } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { isValidPort, type PortKind, portChipStyles } from "./portEditorShared";

const PORTAL_Z_INDEX = 10_000;

export interface PortComboboxFloatingProps {
  anchorEl: HTMLElement;
  kind: PortKind;
  initialValue: string;
  suggestions: string[];
  onCommit: (value: string) => void;
  onCancel: () => void;
}

export function PortComboboxFloating(props: PortComboboxFloatingProps): ReactElement | null {
  const { anchorEl, kind, initialValue, suggestions, onCommit, onCancel } = props;
  const [query, setQuery] = useState(initialValue);
  const [highlight, setHighlight] = useState(0);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  useLayoutEffect(() => {
    const updatePosition = (): void => {
      const rect = anchorEl.getBoundingClientRect();
      setPosition({ top: rect.bottom + 2, left: rect.left });
    };
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [anchorEl]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = suggestions.filter((s) => s !== initialValue);
    if (needle === "") {
      return pool;
    }
    return pool.filter((s) => s.toLowerCase().includes(needle));
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

  if (position === null) {
    return null;
  }

  const content = (
    <div
      style={{
        ...portalShellStyle,
        top: position.top,
        left: position.left,
      }}
      className="nodrag nopan"
    >
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
          window.setTimeout(() => {
            if (!committedRef.current) {
              onCancel();
            }
          }, 120);
        }}
        style={portChipStyles.comboInput}
      />
      {options.length > 0 && (
        <ul style={portChipStyles.comboList}>
          {options.map((option, idx) => {
            const isCreate = canCreate && idx === 0;
            return (
              <li key={option}>
                <button
                  type="button"
                  className="nodrag nopan"
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => {
                    finish(option);
                  }}
                  style={{
                    ...portChipStyles.comboOption,
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
    </div>
  );

  return createPortal(content, document.body);
}

const portalShellStyle: CSSProperties = {
  position: "fixed",
  zIndex: PORTAL_Z_INDEX,
  display: "inline-flex",
  flexDirection: "column",
  alignItems: "stretch",
  minWidth: 140,
};
