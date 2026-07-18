/**
 * ExplanationPanel — the pipeline explanation banner. Fully controlled: the
 * explanation payload and dismissal live in the host.
 *
 * i18n follows the app-core labels pattern: every user-facing string is a
 * label with an English default, and a host overrides them via the optional
 * `labels` prop. Rendering without one yields the exact English strings.
 */

import { Sparkles, X } from "lucide-react";
import type { ReactElement } from "react";

import type { PipelineExplanation } from "../types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export interface ExplanationPanelLabels {
  title: string;
  dismiss: string;
}

// English defaults — must match the strings the web-app rendered before the
// labels seam existed (its `explanation` catalog remains the translation
// source).
export const defaultExplanationPanelLabels: ExplanationPanelLabels = {
  title: "Pipeline explanation",
  dismiss: "Dismiss explanation",
};

export interface ExplanationPanelProps {
  explanation: PipelineExplanation;
  onClose: () => void;
  labels?: Partial<ExplanationPanelLabels>;
}

export function ExplanationPanel({
  explanation,
  onClose,
  labels,
}: ExplanationPanelProps): ReactElement {
  const merged: ExplanationPanelLabels = { ...defaultExplanationPanelLabels, ...labels };
  return (
    <div className="border-b bg-card/95 px-4 py-3 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-primary" />
            <span className="font-semibold tracking-tight">{merged.title}</span>
            <Badge variant="outline" className="font-mono text-[10px]">
              {explanation.backend}
            </Badge>
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
        <p className="whitespace-pre-wrap leading-relaxed text-foreground">{explanation.prose}</p>
        {explanation.warnings.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
            {explanation.warnings.map((warning, idx) => (
              <li key={`warning-${String(idx)}`}>• {warning}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
