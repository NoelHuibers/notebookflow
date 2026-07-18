/**
 * ComposeDialog — the "Compose a pipeline" dialog. Fully controlled: prompt
 * text, busy flag, proposal result, and error state all live in the host.
 *
 * i18n follows the app-core labels pattern: every user-facing string is a
 * label with an English default, and a host overrides them via the optional
 * `labels` prop. Rendering without one yields the exact English strings.
 */

import { Wand2, X } from "lucide-react";
import type { ReactElement } from "react";

import type { PipelineProposal } from "../types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";

export interface ComposeDialogLabels {
  title: string;
  dismiss: string;
  promptPlaceholder: string;
  promptLabel: string;
  drafting: string;
  draft: string;
  replaceWithDraft: string;
}

// English defaults — must match the strings the web-app rendered before the
// labels seam existed (its `compose` catalog remains the translation source).
export const defaultComposeDialogLabels: ComposeDialogLabels = {
  title: "Compose a pipeline",
  dismiss: "Dismiss",
  promptPlaceholder: "e.g. Load customers.csv, filter for EU rows, plot revenue by region",
  promptLabel: "Pipeline description",
  drafting: "Drafting…",
  draft: "Draft pipeline",
  replaceWithDraft: "Replace notebook with draft",
};

export interface ComposeDialogProps {
  prompt: string;
  isComposing: boolean;
  result: PipelineProposal | null;
  errorMessage: string | null;
  onPromptChange: (next: string) => void;
  onSubmit: () => void;
  onApply: () => void;
  onClose: () => void;
  labels?: Partial<ComposeDialogLabels>;
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
  labels,
}: ComposeDialogProps): ReactElement {
  const merged: ComposeDialogLabels = { ...defaultComposeDialogLabels, ...labels };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-6 backdrop-blur">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-md border bg-card p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Wand2 className="size-4 text-primary" />
            {merged.title}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5"
            onClick={onClose}
            aria-label={merged.dismiss}
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
          placeholder={merged.promptPlaceholder}
          aria-label={merged.promptLabel}
          className="resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        {errorMessage !== null && (
          <p className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
            {errorMessage}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" onClick={onSubmit} disabled={isComposing}>
            {isComposing ? merged.drafting : merged.draft}
          </Button>
          {result !== null && result.cellSources.length > 0 && (
            <Button variant="outline" size="sm" onClick={onApply}>
              {merged.replaceWithDraft}
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
