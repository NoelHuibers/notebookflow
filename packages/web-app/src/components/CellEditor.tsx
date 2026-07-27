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
}

function CellEditorImpl({
  cell,
  index,
  outputs = EMPTY_OUTPUTS,
  isStreaming = false,
  onChangeAt,
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
      <Suspense fallback={<EditorFallback source={cell.source} />}>
        <CodeMirrorEditor
          value={cell.source}
          isCode={cell.cellType === "code"}
          onChange={handleChange}
        />
      </Suspense>
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

function EditorFallback({ source }: { source: string }): ReactElement {
  return (
    <pre className="min-h-[40px] overflow-hidden whitespace-pre-wrap break-words bg-[#282c34] px-3 py-2 font-mono text-[12px] text-[#abb2bf]">
      {source === "" ? " " : source}
    </pre>
  );
}
