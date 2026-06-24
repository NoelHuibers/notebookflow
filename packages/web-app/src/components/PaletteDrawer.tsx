import type { NodeManifestDef } from "@notebookflow/graph-canvas";
import { NODE_DRAG_MIME } from "@notebookflow/graph-canvas";
import { X } from "lucide-react";
import type { ReactElement } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { groupPalette, TAG_ORDER } from "@/lib/palette";
import { cn } from "@/lib/utils";

interface PaletteDrawerProps {
  nodes: NodeManifestDef[];
  filteredNodes: NodeManifestDef[];
  error: string | null;
  search: string;
  tagFilter: Set<NodeManifestDef["tag"]>;
  onSearchChange: (next: string) => void;
  onToggleTag: (tag: NodeManifestDef["tag"]) => void;
  onClearFilters: () => void;
  onPick: (manifest: NodeManifestDef) => void;
  onClose: () => void;
}

// Right-side drawer that replaces the old docked palette pane. Opens via the
// canvas "+ Add node" button or Alt+A; closes on Esc, the X, or after a pick.
// Drag-onto-canvas still works because the drawer doesn't cover the canvas
// with a drop-blocking backdrop.
export function PaletteDrawer({
  nodes,
  filteredNodes,
  error,
  search,
  tagFilter,
  onSearchChange,
  onToggleTag,
  onClearFilters,
  onPick,
  onClose,
}: PaletteDrawerProps): ReactElement {
  return (
    <aside className="absolute right-0 top-0 z-20 flex h-full w-72 flex-col border-l bg-card shadow-xl">
      <div className="flex items-center justify-between border-b px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-2">
          Palette
          <Badge variant="outline" className="font-mono text-[10px]">
            {filteredNodes.length === nodes.length
              ? nodes.length
              : `${String(filteredNodes.length)}/${String(nodes.length)}`}
          </Badge>
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5"
          onClick={onClose}
          aria-label="Close palette"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {nodes.length > 0 && (
        <div className="flex flex-col gap-2 border-b px-3 py-2">
          <input
            type="text"
            value={search}
            onChange={(event) => {
              onSearchChange(event.target.value);
            }}
            placeholder="Search nodes…"
            aria-label="Search nodes"
            className="rounded border bg-background px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={onClearFilters}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors",
                tagFilter.size === 0
                  ? "border-foreground bg-foreground text-background"
                  : "bg-background text-muted-foreground hover:bg-muted/70",
              )}
            >
              all
            </button>
            {TAG_ORDER.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  onToggleTag(tag);
                }}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors",
                  tagFilter.has(tag)
                    ? "border-foreground bg-foreground text-background"
                    : "bg-background text-muted-foreground hover:bg-muted/70",
                )}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          {error !== null ? (
            <p className="text-[11px] italic text-muted-foreground">{error}</p>
          ) : nodes.length === 0 ? (
            <p className="text-[11px] italic text-muted-foreground">Loading node registry…</p>
          ) : filteredNodes.length === 0 ? (
            <p className="text-[11px] italic text-muted-foreground">
              No nodes match the current search or filter.
            </p>
          ) : (
            groupPalette(filteredNodes).map(([tag, groupNodes]) => (
              <section key={tag} className="flex flex-col gap-2">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {tag}
                </div>
                <div className="flex flex-col gap-2">
                  {groupNodes.map((manifest) => (
                    <button
                      key={manifest.id}
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData(NODE_DRAG_MIME, manifest.id);
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => {
                        onPick(manifest);
                      }}
                      title={`Click to append at the end, or drag onto the canvas to place at the drop point — ${manifest.name}`}
                      className="cursor-grab rounded-md border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/70 active:cursor-grabbing"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{manifest.name}</span>
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {manifest.tag}
                        </Badge>
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                        {manifest.id}
                      </div>
                      {manifest.description !== "" && (
                        <p className="mt-2 whitespace-pre-wrap text-[11px] text-muted-foreground">
                          {manifest.description}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
