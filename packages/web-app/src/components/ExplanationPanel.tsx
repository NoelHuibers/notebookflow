import { Sparkles, X } from "lucide-react";
import type { ReactElement } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PipelineExplanation } from "@/lib/EngineClient";

interface ExplanationPanelProps {
  explanation: PipelineExplanation;
  onClose: () => void;
}

export function ExplanationPanel({ explanation, onClose }: ExplanationPanelProps): ReactElement {
  return (
    <div className="border-b bg-card/95 px-4 py-3 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-primary" />
            <span className="font-semibold tracking-tight">Pipeline explanation</span>
            <Badge variant="outline" className="font-mono text-[10px]">
              {explanation.backend}
            </Badge>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5"
            onClick={onClose}
            aria-label="Dismiss explanation"
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
