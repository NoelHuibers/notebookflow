/**
 * CellEditor — single-cell wrapper around the lazy-loaded CodeMirror chunk.
 *
 * CodeMirror is ~480 KB minified and dominated the initial bundle, so we
 * load it on first cell render via React.lazy. The Suspense fallback is a
 * read-only <pre> that shows the cell source immediately; once the chunk
 * lands, editing kicks in.
 */

import type { NotebookCell } from "@notebookflow/graph-canvas/sync";
import type { ReactElement } from "react";
import { lazy, Suspense } from "react";

import type { NbOutput } from "@/lib/EngineClient";

import { CellOutputs } from "./CellOutputs";

const CodeMirrorEditor = lazy(() => import("./CodeMirrorEditor"));

export interface CellEditorProps {
  cell: NotebookCell;
  index: number;
  outputs?: NbOutput[];
  onChange: (next: string) => void;
}

export function CellEditor({ cell, index, outputs = [], onChange }: CellEditorProps): ReactElement {
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="font-mono">cell {index}</span>
        <span className="uppercase tracking-wider">{cell.cellType}</span>
      </div>
      <Suspense fallback={<EditorFallback source={cell.source} />}>
        <CodeMirrorEditor
          value={cell.source}
          isCode={cell.cellType === "code"}
          onChange={onChange}
        />
      </Suspense>
      <CellOutputs outputs={outputs} />
    </div>
  );
}

function EditorFallback({ source }: { source: string }): ReactElement {
  return (
    <pre className="min-h-[40px] overflow-x-auto whitespace-pre-wrap bg-[#282c34] px-3 py-2 font-mono text-[12px] text-[#abb2bf]">
      {source === "" ? " " : source}
    </pre>
  );
}
