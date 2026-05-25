/**
 * CellOutputs — render the nbformat outputs captured for one cell.
 *
 * Minimal renderer for issue #11: stream (stdout/stderr), display_data
 * (text/plain only), and error (ename + traceback). Rich rendering of
 * DataFrame HTML tables lives in issue #48; streaming with a cursor is
 * issue #47.
 */

import type { ReactElement } from "react";

import type { NbOutput } from "@/lib/EngineClient";

export interface CellOutputsProps {
  outputs: NbOutput[];
}

export function CellOutputs({ outputs }: CellOutputsProps): ReactElement | null {
  if (outputs.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1 border-t bg-background px-3 py-2 text-[12px]">
      {outputs.map((output, idx) => (
        <OutputBlock key={`output-${String(idx)}`} output={output} />
      ))}
    </div>
  );
}

function OutputBlock({ output }: { output: NbOutput }): ReactElement {
  if (output.output_type === "stream") {
    const colour = output.name === "stderr" ? "text-destructive" : "text-foreground";
    return <pre className={`whitespace-pre-wrap font-mono ${colour}`}>{output.text}</pre>;
  }
  if (output.output_type === "display_data" || output.output_type === "execute_result") {
    const text = output.data["text/plain"] ?? "";
    return <pre className="whitespace-pre-wrap font-mono text-muted-foreground">{text}</pre>;
  }
  return (
    <div className="rounded border border-destructive/40 bg-destructive/5 p-2 font-mono text-destructive">
      <div className="font-semibold">
        {output.ename}: {output.evalue}
      </div>
      <pre className="mt-1 whitespace-pre-wrap text-[11px] opacity-80">
        {output.traceback.join("\n")}
      </pre>
    </div>
  );
}
