import { Files } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ActivityRailProps {
  /** Whether the left workspace (files + code) is open. */
  workspaceOpen: boolean;
  onToggleWorkspace: () => void;
}

/**
 * Thin always-visible rail on the far left. Its Files button toggles the whole
 * left workspace (file list + code cells) as one — the single collapse control
 * for the left side.
 */
export function ActivityRail({
  workspaceOpen,
  onToggleWorkspace,
}: ActivityRailProps): ReactElement {
  return (
    <nav className="flex w-11 shrink-0 flex-col items-center border-r bg-muted/30 py-2">
      <Button
        variant="ghost"
        size="sm"
        className={cn("h-8 w-8 px-0", workspaceOpen && "bg-background text-foreground shadow-sm")}
        title={workspaceOpen ? "Hide files & code" : "Show files & code"}
        aria-label="Toggle files and code"
        aria-pressed={workspaceOpen}
        onClick={onToggleWorkspace}
      >
        <Files className="size-4" />
      </Button>
    </nav>
  );
}
