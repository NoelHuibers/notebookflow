import type { NotebookCell } from "@notebookflow/graph-canvas/sync";
import type { ReactElement } from "react";

import { cn } from "@/lib/utils";

interface CellPaneFooterProps {
  cells: NotebookCell[];
  isDirty: boolean;
}

export function CellPaneFooter({ cells, isDirty }: CellPaneFooterProps): ReactElement {
  const counts = { code: 0, markdown: 0, raw: 0 };
  for (const cell of cells) {
    if (cell.cellType === "code") {
      counts.code += 1;
    } else if (cell.cellType === "markdown") {
      counts.markdown += 1;
    } else {
      counts.raw += 1;
    }
  }
  const total = cells.length;
  return (
    <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-1.5 text-[10px] text-muted-foreground">
      <div className="flex items-center gap-3 font-mono">
        <span>
          {total} {total === 1 ? "cell" : "cells"}
        </span>
        {counts.code > 0 && <span>{counts.code} code</span>}
        {counts.markdown > 0 && <span>{counts.markdown} md</span>}
        {counts.raw > 0 && <span>{counts.raw} raw</span>}
      </div>
      <div className="flex items-center gap-3 font-mono">
        <span
          className={cn(
            "inline-flex items-center gap-1",
            isDirty ? "text-amber-600" : "text-emerald-600",
          )}
        >
          <span
            role="img"
            aria-label={isDirty ? "Modified" : "In sync"}
            className={cn(
              "inline-block size-1.5 rounded-full",
              isDirty ? "bg-amber-500" : "bg-emerald-500",
            )}
          />
          {isDirty ? "modified" : "in sync"}
        </span>
        <span title="Edits re-ingest after a 300ms idle window">auto-ingest 300ms</span>
      </div>
    </div>
  );
}
