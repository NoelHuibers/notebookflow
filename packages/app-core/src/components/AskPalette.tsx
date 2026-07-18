/**
 * AskPalette — the "Ask AI" command palette. Fully controlled: prompt text,
 * busy flag, result, and error state all live in the host.
 *
 * i18n follows the app-core labels pattern: every user-facing string is a
 * label with an English default, and a host overrides them via the optional
 * `labels` prop. Rendering without one yields the exact English strings.
 */

import { Command, X } from "lucide-react";
import type { KeyboardEvent, ReactElement } from "react";
import { useEffect, useRef } from "react";

import type { AskAnswer } from "../types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";

export interface AskPaletteLabels {
  title: string;
  dismiss: string;
  promptPlaceholder: string;
  promptLabel: string;
  thinking: string;
  ask: string;
  shortcutHint: string;
}

// English defaults — must match the strings the web-app rendered before the
// labels seam existed (its `ask` catalog remains the translation source).
export const defaultAskPaletteLabels: AskPaletteLabels = {
  title: "Ask AI",
  dismiss: "Dismiss",
  promptPlaceholder:
    "Ask anything — describe what you want to do, request an explanation, or ask a pandas question",
  promptLabel: "Ask AI prompt",
  thinking: "Thinking…",
  ask: "Ask",
  shortcutHint: "⌘/Ctrl+Enter to send · Esc to close",
};

export interface AskPaletteProps {
  prompt: string;
  isAsking: boolean;
  result: AskAnswer | null;
  errorMessage: string | null;
  onPromptChange: (next: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  labels?: Partial<AskPaletteLabels>;
}

export function AskPalette({
  prompt,
  isAsking,
  result,
  errorMessage,
  onPromptChange,
  onSubmit,
  onClose,
  labels,
}: AskPaletteProps): ReactElement {
  const merged: AskPaletteLabels = { ...defaultAskPaletteLabels, ...labels };
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-6 pt-[15vh] backdrop-blur">
      <div className="flex max-h-[70vh] w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-md border bg-card p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Command className="size-4 text-primary" />
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
          ref={textareaRef}
          rows={3}
          value={prompt}
          onChange={(event) => {
            onPromptChange(event.target.value);
          }}
          onKeyDown={handleKeyDown}
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
          <Button variant="default" size="sm" onClick={onSubmit} disabled={isAsking}>
            {isAsking ? merged.thinking : merged.ask}
          </Button>
          {result !== null && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {result.backend}
            </Badge>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">{merged.shortcutHint}</span>
        </div>
        {result !== null && (
          <ScrollArea className="min-h-[120px] flex-1 rounded border bg-muted/30 p-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.answer}</p>
            {result.warnings.length > 0 && (
              <ul className="mt-3 flex flex-col gap-0.5 text-[10px] text-muted-foreground">
                {result.warnings.map((warning, idx) => (
                  <li key={`ask-warning-${String(idx)}`}>• {warning}</li>
                ))}
              </ul>
            )}
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
