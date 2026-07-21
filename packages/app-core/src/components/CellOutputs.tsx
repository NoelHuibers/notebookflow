/**
 * CellOutputs — render the nbformat outputs captured for one cell.
 *
 * Handles stream (stdout/stderr), display_data + execute_result
 * (text/html preferred for tables, falls back to text/plain), and
 * error (ename + traceback). HTML is sanitized via DOMPurify with a
 * tight allowlist so pandas DataFrame _repr_html_ output renders as a
 * table without opening an XSS vector (see ../outputHtml).
 *
 * When `isStreaming` is true (the matching node is mid-execution), the
 * component renders a blinking cursor inline with the last stream output
 * -- or as a standalone block when there are no outputs yet -- so the
 * cell view reads as "live" even before the engine flushes any data.
 *
 * i18n follows the app-core labels pattern: every user-facing string is a
 * label with an English default, and a host overrides them via the optional
 * `labels` prop. Rendering without one yields the exact English strings.
 */

import type { ReactElement } from "react";
import { useMemo } from "react";

import { sanitizeOutputHtml } from "../outputHtml";
import type { NbOutput } from "../types";

export interface CellOutputsLabels {
  /** aria-label of the blinking streaming cursor. */
  streaming: string;
  /** Tooltip of the blinking streaming cursor. */
  streamingTitle: string;
  /** alt text of a rendered image/png output (e.g. a matplotlib figure). */
  outputFigureAlt: string;
}

// English defaults — must match the strings the web-app rendered before the
// labels seam existed (its `cells` catalog remains the translation source).
export const defaultCellOutputsLabels: CellOutputsLabels = {
  streaming: "Streaming",
  streamingTitle: "Node is executing — output streaming",
  outputFigureAlt: "Cell output figure",
};

export interface CellOutputsProps {
  outputs: readonly NbOutput[];
  isStreaming?: boolean;
  labels?: Partial<CellOutputsLabels>;
}

export function CellOutputs({
  outputs,
  isStreaming = false,
  labels,
}: CellOutputsProps): ReactElement | null {
  const merged: CellOutputsLabels = { ...defaultCellOutputsLabels, ...labels };
  if (outputs.length === 0 && !isStreaming) {
    return null;
  }
  // Anchor the cursor inside the last stream output when one exists, so it
  // sits flush against the trailing text rather than on a new line.
  const lastIndex = outputs.length - 1;
  const lastIsStream = lastIndex >= 0 && outputs[lastIndex]?.output_type === "stream";
  const inlineCursor = isStreaming && lastIsStream;
  return (
    <div className="flex min-w-0 flex-col gap-1 border-t bg-background px-3 py-2 text-[12px]">
      {outputs.map((output, idx) => (
        <OutputBlock
          key={`output-${String(idx)}`}
          output={output}
          trailingCursor={inlineCursor && idx === lastIndex}
          labels={merged}
        />
      ))}
      {isStreaming && !lastIsStream && (
        <pre className="whitespace-pre-wrap break-words font-mono text-muted-foreground">
          <StreamingCursor labels={merged} />
        </pre>
      )}
    </div>
  );
}

function StreamingCursor({ labels }: { labels: CellOutputsLabels }): ReactElement {
  return (
    <span
      role="img"
      aria-label={labels.streaming}
      title={labels.streamingTitle}
      className="ml-px inline-block h-[1em] w-[0.5em] translate-y-[0.15em] animate-pulse rounded-sm bg-current align-middle"
    />
  );
}

interface OutputBlockProps {
  output: NbOutput;
  trailingCursor?: boolean;
  labels: CellOutputsLabels;
}

function OutputBlock({ output, trailingCursor = false, labels }: OutputBlockProps): ReactElement {
  if (output.output_type === "stream") {
    const colour = output.name === "stderr" ? "text-destructive" : "text-foreground";
    return (
      <pre className={`whitespace-pre-wrap break-words font-mono ${colour}`}>
        {output.text}
        {trailingCursor && <StreamingCursor labels={labels} />}
      </pre>
    );
  }
  if (output.output_type === "display_data" || output.output_type === "execute_result") {
    return <RichOutput data={output.data} labels={labels} />;
  }
  return (
    <div className="rounded border border-destructive/40 bg-destructive/5 p-2 font-mono text-destructive">
      <div className="font-semibold">
        {output.ename}: {output.evalue}
      </div>
      <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] opacity-80">
        {output.traceback.join("\n")}
      </pre>
    </div>
  );
}

function RichOutput({
  data,
  labels,
}: {
  data: Record<string, string>;
  labels: CellOutputsLabels;
}): ReactElement {
  const html = data["text/html"];
  const sanitized = useMemo(() => {
    if (html === undefined) {
      return null;
    }
    return sanitizeOutputHtml(html);
  }, [html]);

  // Images (e.g. captured matplotlib figures) — the src is a controlled
  // base64 data URI the engine produced, not user-authored HTML.
  const png = data["image/png"];
  if (png !== undefined) {
    return (
      <img
        src={`data:image/png;base64,${png}`}
        alt={labels.outputFigureAlt}
        className="max-w-full rounded border bg-white"
      />
    );
  }

  if (sanitized !== null) {
    return (
      <div
        className="cell-output-html min-w-0 max-w-full overflow-hidden"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized via DOMPurify with a strict tag/attr allowlist
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    );
  }
  const text = data["text/plain"] ?? "";
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-muted-foreground">{text}</pre>
  );
}
