/**
 * CellList — vertical stack of CellEditors with debounced propagation.
 *
 * Receives the current ``cells`` array from the App and emits
 * ``onCellsChange`` after a 300 ms idle window so SyncEngine re-ingests
 * don't fire per keystroke.
 */

import type { NotebookCell } from "@notebookflow/graph-canvas/sync";
import type { ReactElement } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { CellEditor } from "./CellEditor";

const DEBOUNCE_MS = 300;

export interface CellListProps {
  cells: NotebookCell[];
  onCellsChange: (next: NotebookCell[]) => void;
}

export function CellList({ cells, onCellsChange }: CellListProps): ReactElement {
  const [draft, setDraft] = useState<NotebookCell[]>(cells);
  const incomingRef = useRef(cells);
  const onChangeRef = useRef(onCellsChange);

  // Keep refs current so the debounced flush always sees fresh callbacks.
  useEffect(() => {
    onChangeRef.current = onCellsChange;
  }, [onCellsChange]);

  // When the parent's cells change (e.g. a new file is loaded), reset the draft.
  useEffect(() => {
    if (cells !== incomingRef.current) {
      incomingRef.current = cells;
      setDraft(cells);
    }
  }, [cells]);

  const handleChange = useCallback((index: number, nextSource: string) => {
    setDraft((prev) => {
      const cell = prev[index];
      if (cell === undefined || cell.source === nextSource) {
        return prev;
      }
      const next = prev.slice();
      next[index] = { ...cell, source: nextSource };
      return next;
    });
  }, []);

  // Debounce the propagation back up to the parent. We compare against
  // incomingRef so we don't echo our own state right back when the parent
  // already has the latest version.
  useEffect(() => {
    if (draft === incomingRef.current) {
      return;
    }
    const handle = setTimeout(() => {
      incomingRef.current = draft;
      onChangeRef.current(draft);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [draft]);

  return (
    <div className="flex flex-col gap-3 p-4">
      {draft.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">No cells yet — drop a notebook.</p>
      ) : (
        draft.map((cell, idx) => (
          <CellEditor
            key={`cell-${String(idx)}`}
            cell={cell}
            index={idx}
            onChange={(next) => {
              handleChange(idx, next);
            }}
          />
        ))
      )}
    </div>
  );
}
