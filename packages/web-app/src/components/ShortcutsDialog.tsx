import { Keyboard, X } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

// `keys` glyphs stay literal; `labelKey` resolves through the `shortcuts` catalog.
const SHORTCUTS: { keys: string; labelKey: string }[] = [
  { keys: "⌘/Ctrl + K", labelKey: "shortcuts.askAi" },
  { keys: "Alt + A", labelKey: "shortcuts.toggleNodePalette" },
  { keys: "M", labelKey: "shortcuts.toggleMinimap" },
  { keys: "?", labelKey: "shortcuts.thisShortcutsList" },
  { keys: "Esc", labelKey: "shortcuts.closePaletteDialog" },
  { keys: "Click", labelKey: "shortcuts.selectNode" },
  { keys: "Double-click", labelKey: "shortcuts.renameNode" },
  { keys: "Drag", labelKey: "shortcuts.panCanvas" },
  { keys: "⌘/Ctrl + Wheel", labelKey: "shortcuts.zoomCanvas" },
  { keys: "⌘/Ctrl + Enter", labelKey: "shortcuts.sendInAskCompose" },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-6 pt-[12vh] backdrop-blur">
      <div className="w-full max-w-md rounded-md border bg-card p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Keyboard className="size-4 text-primary" />
            {t("shortcuts.title")}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5"
            onClick={onClose}
            aria-label={t("shortcuts.dismiss")}
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <ul className="flex flex-col gap-1.5 text-[12px]">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{t(s.labelKey)}</span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
