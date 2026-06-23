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

import type { NbOutput } from "@/lib/EngineClient";

import { CellEditor } from "./CellEditor";

const DEBOUNCE_MS = 300;

export interface CellListProps {
  cells: NotebookCell[];
  onCellsChange: (next: NotebookCell[]) => void;
  outputsByCell?: Record<number, NbOutput[]>;
  /**
   * Cell index to scroll into view. When this changes to a defined value, the
   * matching cell wrapper is brought to the top of the visible area. Used by
   * the canvas selection-to-cells handoff.
   */
  scrollToCellIndex?: number | null;
}

export function CellList({
  cells,
  onCellsChange,
  outputsByCell,
  scrollToCellIndex,
}: CellListProps): ReactElement {
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

  // Scroll the targeted cell into view when the parent asks for it (e.g. the
  // user clicks a node in the canvas). Looked up by data-cell-index rather
  // than a ref map so adding/removing cells doesn't require ref bookkeeping.
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollToCellIndex === undefined || scrollToCellIndex === null || scrollToCellIndex < 0) {
      return;
    }
    const root = containerRef.current;
    if (root === null) {
      return;
    }
    const target = root.querySelector<HTMLElement>(
      `[data-cell-index="${String(scrollToCellIndex)}"]`,
    );
    if (target !== null) {
      target.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [scrollToCellIndex]);

  return (
    <div ref={containerRef} className="flex flex-col gap-3 p-4">
      {draft.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">No cells yet — drop a notebook.</p>
      ) : (
        draft.map((cell, idx) => (
          <div key={`cell-${String(idx)}`} data-cell-index={idx}>
            <CellEditor
              cell={cell}
              index={idx}
              outputs={outputsByCell?.[idx] ?? []}
              onChange={(next) => {
                handleChange(idx, next);
              }}
            />
          </div>
        ))
      )}
    </div>
  );
}
