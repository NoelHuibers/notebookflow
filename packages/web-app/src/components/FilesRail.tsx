import { Plus, X } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { OpenFileMeta } from "@/types/workspace";

interface FilesRailProps {
  files: OpenFileMeta[];
  activeFileId: string;
  activeDirty: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onOpen: () => void;
}

// Left-hand workspace explorer: the open notebooks, with open / switch /
// close. The active file's name + dirty dot live here. Shown/hidden as one
// with the code cells via the activity rail; no collapse control of its own.
export function FilesRail({
  files,
  activeFileId,
  activeDirty,
  onSelect,
  onClose,
  onOpen,
}: FilesRailProps): ReactElement {
  return (
    <aside className="flex w-48 shrink-0 flex-col border-r bg-muted/30">
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium">Files</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-1.5"
          title="Open notebook"
          aria-label="Open notebook"
          onClick={onOpen}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col p-1">
          {files.map((file) => {
            const isActive = file.id === activeFileId;
            return (
              <li key={file.id}>
                <div
                  className={cn(
                    "group flex items-center gap-1.5 rounded px-2 py-1 text-[12px]",
                    isActive ? "bg-background font-medium" : "hover:bg-muted/60",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(file.id);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    title={file.name}
                  >
                    {isActive && activeDirty && (
                      <span
                        role="img"
                        aria-label="Unsaved changes"
                        className="size-1.5 shrink-0 rounded-full bg-amber-500"
                      />
                    )}
                    <span className="truncate font-mono text-[11px]">{file.name}</span>
                  </button>
                  {files.length > 1 && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onClose(file.id);
                      }}
                      className="shrink-0 rounded text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                      aria-label={`Close ${file.name}`}
                      title={`Close ${file.name}`}
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </aside>
  );
}
