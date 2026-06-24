import { Wand2, X } from "lucide-react";
import type { ReactElement } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { PipelineProposal } from "@/lib/EngineClient";

interface ComposeDialogProps {
  prompt: string;
  isComposing: boolean;
  result: PipelineProposal | null;
  errorMessage: string | null;
  onPromptChange: (next: string) => void;
  onSubmit: () => void;
  onApply: () => void;
  onClose: () => void;
}

export function ComposeDialog({
  prompt,
  isComposing,
  result,
  errorMessage,
  onPromptChange,
  onSubmit,
  onApply,
  onClose,
}: ComposeDialogProps): ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-6 backdrop-blur">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-md border bg-card p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Wand2 className="size-4 text-primary" />
            Compose a pipeline
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5"
            onClick={onClose}
            aria-label="Dismiss"
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <textarea
          rows={4}
          value={prompt}
          onChange={(event) => {
            onPromptChange(event.target.value);
          }}
          placeholder="e.g. Load customers.csv, filter for EU rows, plot revenue by region"
          aria-label="Pipeline description"
          className="resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        {errorMessage !== null && (
          <p className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
            {errorMessage}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" onClick={onSubmit} disabled={isComposing}>
            {isComposing ? "Drafting…" : "Draft pipeline"}
          </Button>
          {result !== null && result.cellSources.length > 0 && (
            <Button variant="outline" size="sm" onClick={onApply}>
              Replace notebook with draft
            </Button>
          )}
          {result !== null && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {result.backend}
            </Badge>
          )}
        </div>
        {result !== null && (
          <ScrollArea className="min-h-[120px] flex-1 rounded border bg-muted/30 p-2">
            <ul className="flex flex-col gap-1.5 text-[11px] font-mono">
              {result.nodes.map((node, idx) => (
                <li key={`node-${String(idx)}`} className="rounded border bg-background px-2 py-1">
                  <span className="font-semibold">
                    {idx + 1}. {node.name}
                  </span>
                  <span className="ml-2 text-muted-foreground">{node.manifestId}</span>
                </li>
              ))}
            </ul>
            {result.edges.length > 0 && (
              <p className="mt-2 text-[10px] text-muted-foreground">
                {result.edges.map((edge) => `${edge.from} → ${edge.to}`).join("  ·  ")}
              </p>
            )}
            {result.warnings.length > 0 && (
              <ul className="mt-2 flex flex-col gap-0.5 text-[10px] text-muted-foreground">
                {result.warnings.map((warning, idx) => (
                  <li key={`warning-${String(idx)}`}>• {warning}</li>
                ))}
              </ul>
            )}
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
