import { Command, X } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AskAnswer } from "@/lib/EngineClient";
import { useI18n } from "@/lib/i18n";

interface AskPaletteProps {
  prompt: string;
  isAsking: boolean;
  result: AskAnswer | null;
  errorMessage: string | null;
  onPromptChange: (next: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function AskPalette({
  prompt,
  isAsking,
  result,
  errorMessage,
  onPromptChange,
  onSubmit,
  onClose,
}: AskPaletteProps): ReactElement {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);
  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
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
            {t("ask.title")}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5"
            onClick={onClose}
            aria-label={t("ask.dismiss")}
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
          placeholder={t("ask.promptPlaceholder")}
          aria-label={t("ask.promptLabel")}
          className="resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        {errorMessage !== null && (
          <p className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
            {errorMessage}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" onClick={onSubmit} disabled={isAsking}>
            {isAsking ? t("ask.thinking") : t("ask.ask")}
          </Button>
          {result !== null && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {result.backend}
            </Badge>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">{t("ask.shortcutHint")}</span>
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
