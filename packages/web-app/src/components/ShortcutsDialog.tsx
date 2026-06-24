import { Keyboard, X } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "⌘/Ctrl + K", label: "Ask AI" },
  { keys: "Alt + A", label: "Toggle node palette" },
  { keys: "M", label: "Toggle minimap" },
  { keys: "?", label: "This shortcuts list" },
  { keys: "Esc", label: "Close palette / dialog" },
  { keys: "Click", label: "Select node" },
  { keys: "Double-click", label: "Rename node" },
  { keys: "Drag", label: "Pan the canvas" },
  { keys: "⌘/Ctrl + Wheel", label: "Zoom the canvas" },
  { keys: "⌘/Ctrl + Enter", label: "Send (in Ask / Compose)" },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-6 pt-[12vh] backdrop-blur">
      <div className="w-full max-w-md rounded-md border bg-card p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Keyboard className="size-4 text-primary" />
            Keyboard shortcuts
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
        <ul className="flex flex-col gap-1.5 text-[12px]">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{s.label}</span>
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
