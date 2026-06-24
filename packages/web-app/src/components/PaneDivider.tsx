import type {
  ReactElement,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import { cn } from "@/lib/utils";
import type { DragAxis } from "@/types/workspace";

interface PaneDividerProps {
  orientation: DragAxis;
  label: string;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}

export function PaneDivider({
  orientation,
  label,
  onPointerDown,
  onKeyDown,
}: PaneDividerProps): ReactElement {
  const isVertical = orientation === "vertical";

  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        "group relative flex shrink-0 touch-none select-none items-center justify-center border-0 bg-muted/70 p-0",
        isVertical ? "h-full cursor-col-resize" : "w-full cursor-row-resize",
      )}
    >
      <div
        className={cn(
          "rounded-full bg-border transition-colors group-hover:bg-foreground/30 group-active:bg-foreground/45",
          isVertical ? "h-14 w-1" : "h-1 w-14",
        )}
      />
    </button>
  );
}
