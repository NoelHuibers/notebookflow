/**
 * CellEditor — single-cell CodeMirror wrapper.
 *
 * Renders one notebook cell as an editable text region. Code cells get
 * Python syntax highlighting; markdown / raw cells render as plain text.
 * Edits propagate via ``onChange`` — the parent debounces before pushing
 * through the SyncEngine.
 */

import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import type { NotebookCell } from "@notebookflow/graph-canvas/sync";
import CodeMirror from "@uiw/react-codemirror";
import type { ReactElement } from "react";
import { useMemo } from "react";

export interface CellEditorProps {
  cell: NotebookCell;
  index: number;
  onChange: (next: string) => void;
}

export function CellEditor({ cell, index, onChange }: CellEditorProps): ReactElement {
  const extensions = useMemo(() => (cell.cellType === "code" ? [python()] : []), [cell.cellType]);

  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="font-mono">cell {index}</span>
        <span className="uppercase tracking-wider">{cell.cellType}</span>
      </div>
      <CodeMirror
        value={cell.source}
        height="auto"
        minHeight="40px"
        theme={oneDark}
        extensions={extensions}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
      />
    </div>
  );
}
