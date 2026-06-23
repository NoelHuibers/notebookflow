/**
 * CellOutputs — render the nbformat outputs captured for one cell.
 *
 * Handles stream (stdout/stderr), display_data + execute_result
 * (text/html preferred for tables, falls back to text/plain), and
 * error (ename + traceback). HTML is sanitized via DOMPurify with a
 * tight allowlist so pandas DataFrame _repr_html_ output renders as a
 * table without opening an XSS vector.
 *
 * When `isStreaming` is true (the matching node is mid-execution), the
 * component renders a blinking cursor inline with the last stream output
 * -- or as a standalone block when there are no outputs yet -- so the
 * cell view reads as "live" even before the engine flushes any data.
 */

import DOMPurify from "dompurify";
import type { ReactElement } from "react";
import { useMemo } from "react";

import type { NbOutput } from "@/lib/EngineClient";

export interface CellOutputsProps {
  outputs: NbOutput[];
  isStreaming?: boolean;
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

export function CellOutputs({
  outputs,
  isStreaming = false,
}: CellOutputsProps): ReactElement | null {
  if (outputs.length === 0 && !isStreaming) {
    return null;
  }
  // Anchor the cursor inside the last stream output when one exists, so it
  // sits flush against the trailing text rather than on a new line.
  const lastIndex = outputs.length - 1;
  const lastIsStream = lastIndex >= 0 && outputs[lastIndex]?.output_type === "stream";
  const inlineCursor = isStreaming && lastIsStream;
  return (
    <div className="flex flex-col gap-1 border-t bg-background px-3 py-2 text-[12px]">
      {outputs.map((output, idx) => (
        <OutputBlock
          key={`output-${String(idx)}`}
          output={output}
          trailingCursor={inlineCursor && idx === lastIndex}
        />
      ))}
      {isStreaming && !lastIsStream && (
        <pre className="whitespace-pre-wrap font-mono text-muted-foreground">
          <StreamingCursor />
        </pre>
      )}
    </div>
  );
}

function StreamingCursor(): ReactElement {
  return (
    <span
      role="img"
      aria-label="Streaming"
      title="Node is executing — output streaming"
      className="ml-px inline-block h-[1em] w-[0.5em] translate-y-[0.15em] animate-pulse rounded-sm bg-current align-middle"
    />
  );
}

interface OutputBlockProps {
  output: NbOutput;
  trailingCursor?: boolean;
}

function OutputBlock({ output, trailingCursor = false }: OutputBlockProps): ReactElement {
  if (output.output_type === "stream") {
    const colour = output.name === "stderr" ? "text-destructive" : "text-foreground";
    return (
      <pre className={`whitespace-pre-wrap font-mono ${colour}`}>
        {output.text}
        {trailingCursor && <StreamingCursor />}
      </pre>
    );
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
