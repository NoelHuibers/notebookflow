/**
 * CellList — vertical stack of CellEditors with debounced propagation.
 *
 * Receives the current ``cells`` array from the App and emits
 * ``onCellsChange`` after a 300 ms idle window so SyncEngine re-ingests
 * don't fire per keystroke.
 */

import type { NotebookCell } from "@notebookflow/graph-canvas/sync";
import type { ReactElement } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNearCellIndices } from "@/hooks/useNearCellIndices";
import { shouldRenderFullEditor } from "@/lib/cellVirtualization";
import type { NbOutput } from "@/lib/EngineClient";
import { useI18n } from "@/lib/i18n";

import { CellEditor } from "./CellEditor";

const DEBOUNCE_MS = 300;

// Shared frozen fallback so cells without outputs get an identity-stable prop
// (a fresh `[]` per render would defeat CellEditor's memo).
const EMPTY_OUTPUTS: readonly NbOutput[] = Object.freeze([]);

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
  /** Monotonic trigger for re-scrolling the same cell after repeated selection. */
  scrollToCellRevision?: number;
  /** Currently focused cell index (driven by the toolbar). */
  focusedCellIndex?: number | null;
  /** Notify the parent when a cell wrapper is clicked. */
  onFocusCell?: (index: number) => void;
  /**
   * Cell whose node is currently executing on the engine. The matching
   * `CellOutputs` renders a blinking cursor at the end of its outputs while
   * this is set.
   */
  streamingCellIndex?: number | null;
}

export function CellList({
  cells,
  onCellsChange,
  outputsByCell,
  scrollToCellIndex,
  scrollToCellRevision,
  focusedCellIndex,
  onFocusCell,
  streamingCellIndex,
}: CellListProps): ReactElement {
  const { t } = useI18n();
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
    void scrollToCellRevision;
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
  }, [scrollToCellIndex, scrollToCellRevision]);

  // Cell virtualization: only cells near the viewport (plus the focused and
  // streaming cells) mount the live CodeMirror editor; the rest render the
  // lightweight read-only fallback. `nearIndices === null` means "all near"
  // (first paint before the observer reports, and SSR/jsdom) → today's behavior.
  const nearIndices = useNearCellIndices(containerRef, draft.length);

  // Last-known full-editor wrapper heights, keyed by cell index. Captured after
  // paint while a cell is still full, then applied as the fallback's min-height
  // the moment it demotes so the scroll position can't jump. `renderFullFlags`
  // records which cells are full this render so the effect never overwrites a
  // frozen height with a (shorter) fallback measurement.
  const heightsRef = useRef<Map<number, number>>(new Map());
  const renderFullFlags = draft.map((_, idx) =>
    nearIndices === null
      ? true
      : shouldRenderFullEditor(idx, { nearIndices, focusedCellIndex, streamingCellIndex }),
  );
  const flagsRef = useRef(renderFullFlags);
  flagsRef.current = renderFullFlags;

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (root === null) {
      return;
    }
    const flags = flagsRef.current;
    for (let idx = 0; idx < flags.length; idx += 1) {
      if (flags[idx] !== true) {
        continue;
      }
      const el = root.querySelector<HTMLElement>(`[data-cell-index="${String(idx)}"]`);
      if (el !== null) {
        const height = el.offsetHeight;
        if (height > 0) {
          heightsRef.current.set(idx, height);
        }
      }
    }
  });

  return (
    <div ref={containerRef} className="flex min-w-0 flex-col gap-3 p-4">
      {draft.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">{t("cells.empty")}</p>
      ) : (
        draft.map((cell, idx) => {
          const isFocused = focusedCellIndex === idx;
          const renderFull = renderFullFlags[idx] ?? true;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: focus indicator on click; CellEditor itself remains keyboard-accessible
            <div
              key={`cell-${String(idx)}`}
              data-cell-index={idx}
              onMouseDown={() => {
                onFocusCell?.(idx);
              }}
              className={
                isFocused
                  ? "min-w-0 rounded-md ring-2 ring-ring/60 ring-offset-2 ring-offset-background transition-shadow"
                  : "min-w-0 transition-shadow"
              }
            >
              <CellEditor
                cell={cell}
                index={idx}
                outputs={outputsByCell?.[idx] ?? EMPTY_OUTPUTS}
                isStreaming={streamingCellIndex === idx}
                onChangeAt={handleChange}
                renderFullEditor={renderFull}
                fallbackMinHeight={renderFull ? null : (heightsRef.current.get(idx) ?? null)}
              />
            </div>
          );
        })
      )}
    </div>
  );
}
