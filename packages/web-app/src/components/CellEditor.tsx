/**
 * CellEditor — single-cell wrapper around the lazy-loaded CodeMirror chunk.
 *
 * CodeMirror is ~480 KB minified and dominated the initial bundle, so we
 * load it on first cell render via React.lazy. The Suspense fallback is a
 * read-only <pre> that shows the cell source immediately; once the chunk
 * lands, editing kicks in.
 */

import { CellOutputs, type CellOutputsLabels } from "@notebookflow/app-core";
import type { NotebookCell } from "@notebookflow/graph-canvas/sync";
import type { ReactElement } from "react";
import { lazy, memo, Suspense, useCallback, useMemo } from "react";

import type { NbOutput } from "@/lib/EngineClient";
import { useI18n } from "@/lib/i18n";

const CodeMirrorEditor = lazy(() => import("./CodeMirrorEditor"));

const EMPTY_OUTPUTS: readonly NbOutput[] = Object.freeze([]);

export interface CellEditorProps {
  cell: NotebookCell;
  index: number;
  outputs?: readonly NbOutput[];
  isStreaming?: boolean;
  /**
   * Stable index-tagged change callback. Taking the index here (rather than a
   * per-cell closure in the list) keeps the prop identity constant across
   * renders so the `memo` wrapper below actually skips unchanged cells.
   */
  onChangeAt: (index: number, next: string) => void;
  /**
   * Cell virtualization: when false the live CodeMirror editor is not mounted
   * and the lightweight read-only fallback is shown instead. `CellList` sets
   * this for cells far outside the viewport. Defaults to true (mount the
   * editor) so every other caller keeps today's behavior.
   */
  renderFullEditor?: boolean;
  /**
   * Frozen wrapper height (px) captured just before this cell demoted to the
   * fallback, applied as the fallback's `min-height` so the surrounding scroll
   * position can't shift when a tall editor collapses to a short `<pre>`.
   */
  fallbackMinHeight?: number | null;
}

function CellEditorImpl({
  cell,
  index,
  outputs = EMPTY_OUTPUTS,
  isStreaming = false,
  onChangeAt,
  renderFullEditor = true,
  fallbackMinHeight = null,
}: CellEditorProps): ReactElement {
  const { t } = useI18n();
  // Translate the shared CellOutputs labels (component lives in app-core; the
  // `cells` catalog here stays the translation source).
  const outputsLabels = useMemo<CellOutputsLabels>(
    () => ({
      streaming: t("cells.streaming"),
      streamingTitle: t("cells.streamingTitle"),
      outputFigureAlt: t("cells.outputFigureAlt"),
    }),
    [t],
  );
  const handleChange = useCallback(
    (next: string) => {
      onChangeAt(index, next);
    },
    [onChangeAt, index],
  );
  const typeLabelKey =
    cell.cellType === "markdown"
      ? "cells.typeMarkdown"
      : cell.cellType === "raw"
        ? "cells.typeRaw"
        : "cells.typeCode";
  return (
    <div className="min-w-0 overflow-hidden rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="font-mono">{t("cells.cellLabel", { index })}</span>
        <span className="uppercase tracking-wider">{t(typeLabelKey)}</span>
      </div>
      {renderFullEditor ? (
        <Suspense fallback={<EditorFallback source={cell.source} />}>
          <CodeMirrorEditor
            value={cell.source}
            isCode={cell.cellType === "code"}
            onChange={handleChange}
          />
        </Suspense>
      ) : (
        <EditorFallback source={cell.source} minHeight={fallbackMinHeight} />
      )}
      <CellOutputs outputs={outputs} isStreaming={isStreaming} labels={outputsLabels} />
    </div>
  );
}

/**
 * Memoized so typing in one cell doesn't re-render every other cell: CellList
 * keeps `cell`, `outputs` and `onChangeAt` referentially stable for untouched
 * cells, making the shallow prop comparison effective.
 */
export const CellEditor = memo(CellEditorImpl);

function EditorFallback({
  source,
  minHeight = null,
}: {
  source: string;
  minHeight?: number | null;
}): ReactElement {
  return (
    <pre
      className="min-h-[40px] overflow-hidden whitespace-pre-wrap break-words bg-[#282c34] px-3 py-2 font-mono text-[12px] text-[#abb2bf]"
      style={
        minHeight !== null && minHeight > 0 ? { minHeight: `${String(minHeight)}px` } : undefined
      }
    >
      {source === "" ? " " : source}
    </pre>
  );
}
