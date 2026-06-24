import type { ReactElement } from "react";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface InspectorPanelProps {
  title: string;
  count: number;
  empty: string;
  children?: React.ReactNode;
}

export function InspectorPanel({
  title,
  count,
  empty,
  children,
}: InspectorPanelProps): ReactElement {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {title}
        <Badge variant="outline" className="font-mono text-[10px]">
          {count}
        </Badge>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-3">
          {count === 0 ? (
            <p className="text-[11px] italic text-muted-foreground">{empty}</p>
          ) : (
            children
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
