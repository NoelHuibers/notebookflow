import { ChevronDown } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface CollapsibleSidebarSectionProps {
  title: string;
  badge?: string;
  collapsed: boolean;
  onToggle: () => void;
  /** When true, expanded content fills remaining sidebar height (for scrollable lists). */
  fill?: boolean;
  children: ReactNode;
}

export function CollapsibleSidebarSection({
  title,
  badge,
  collapsed,
  onToggle,
  fill = false,
  children,
}: CollapsibleSidebarSectionProps): ReactElement {
  return (
    <section className={cn("flex flex-col border-b", fill && !collapsed && "min-h-0 flex-1")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full shrink-0 items-center gap-2 px-3 py-1.5 text-left text-[11px] uppercase tracking-wider text-muted-foreground hover:bg-muted/50"
      >
        <ChevronDown
          className={cn("size-3 shrink-0 transition-transform", collapsed && "-rotate-90")}
          aria-hidden="true"
        />
        <span className="flex flex-1 items-center gap-2">
          {title}
          {badge !== undefined && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {badge}
            </Badge>
          )}
        </span>
      </button>
      {!collapsed && (
        <div
          className={cn(
            "px-3 pb-3",
            fill && "flex min-h-0 flex-1 flex-col overflow-hidden pt-0",
            !fill && "pt-0",
          )}
        >
          {children}
        </div>
      )}
    </section>
  );
}
