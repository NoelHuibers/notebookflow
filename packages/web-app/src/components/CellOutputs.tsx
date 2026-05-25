/**
 * CellOutputs — render the nbformat outputs captured for one cell.
 *
 * Handles stream (stdout/stderr), display_data + execute_result
 * (text/html preferred for tables, falls back to text/plain), and
 * error (ename + traceback). HTML is sanitized via DOMPurify with a
 * tight allowlist so pandas DataFrame _repr_html_ output renders as a
 * table without opening an XSS vector. Streaming with a cursor is #47.
 */

import DOMPurify from "dompurify";
import type { ReactElement } from "react";
import { useMemo } from "react";

import type { NbOutput } from "@/lib/EngineClient";

export interface CellOutputsProps {
  outputs: NbOutput[];
}

const HTML_ALLOWED_TAGS = [
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "colgroup",
  "col",
  "div",
  "span",
  "br",
  "p",
  "strong",
  "em",
  "code",
];

const HTML_ALLOWED_ATTR = ["class", "colspan", "rowspan", "scope", "title"];

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
    return <RichOutput data={output.data} />;
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

function RichOutput({ data }: { data: Record<string, string> }): ReactElement {
  const html = data["text/html"];
  const sanitized = useMemo(() => {
    if (html === undefined) {
      return null;
    }
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: HTML_ALLOWED_TAGS,
      ALLOWED_ATTR: HTML_ALLOWED_ATTR,
    });
  }, [html]);

  if (sanitized !== null) {
    return (
      <div
        className="cell-output-html overflow-x-auto"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized via DOMPurify with a strict tag/attr allowlist
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    );
  }
  const text = data["text/plain"] ?? "";
  return <pre className="whitespace-pre-wrap font-mono text-muted-foreground">{text}</pre>;
}
