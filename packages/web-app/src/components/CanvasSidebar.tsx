import type { NodeManifestDef, NodeModel } from "@notebookflow/graph-canvas";
import { NODE_DRAG_MIME, NodeConfigEditor } from "@notebookflow/graph-canvas";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";

import { CollapsibleSidebarSection } from "@/components/CollapsibleSidebarSection";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/lib/i18n";
import { groupPalette, TAG_ORDER } from "@/lib/palette";
import { cn } from "@/lib/utils";

interface CanvasSidebarProps {
  selected: NodeModel | null;
  selectedManifest: NodeManifestDef | null;
  configDraft: Record<string, string>;
  isConfigDirty: boolean;
  isConfigSubmitting: boolean;
  isConfigBlocked: boolean;
  configError: string | null;
  configWarnings: string[];
  configStatus: string | null;
  onConfigChange: (key: string, value: string) => void;
  onApplyConfig: () => void;
  nodes: NodeManifestDef[];
  filteredNodes: NodeManifestDef[];
  error: string | null;
  search: string;
  tagFilter: Set<NodeManifestDef["tag"]>;
  onSearchChange: (next: string) => void;
  onToggleTag: (tag: NodeManifestDef["tag"]) => void;
  onClearFilters: () => void;
  onPick: (manifest: NodeManifestDef) => void;
}

/** Right sidebar — selected node inspector above the node palette. */
export function CanvasSidebar(props: CanvasSidebarProps): ReactElement {
  const { t } = useI18n();
  const {
    selected,
    selectedManifest,
    configDraft,
    isConfigDirty,
    isConfigSubmitting,
    isConfigBlocked,
    configError,
    configWarnings,
    configStatus,
    onConfigChange,
    onApplyConfig,
    nodes,
    filteredNodes,
    error,
    search,
    tagFilter,
    onSearchChange,
    onToggleTag,
    onClearFilters,
    onPick,
  } = props;

  const [selectedCollapsed, setSelectedCollapsed] = useState(false);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);

  useEffect(() => {
    if (selected !== null) {
      setSelectedCollapsed(false);
    }
  }, [selected?.id, selected]);

  const paletteBadge =
    filteredNodes.length === nodes.length
      ? String(nodes.length)
      : `${String(filteredNodes.length)}/${String(nodes.length)}`;

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-card text-xs">
      <CollapsibleSidebarSection
        title={t("app.panels.selected")}
        badge={selected === null ? "0" : "1"}
        collapsed={selectedCollapsed}
        onToggle={() => {
          setSelectedCollapsed((open) => !open);
        }}
      >
        {selected === null ? (
          <p className="text-[11px] italic text-muted-foreground">
            {t("app.panels.selectedEmpty")}
          </p>
        ) : selectedManifest !== null && selectedManifest.configFields.length > 0 ? (
          <NodeConfigEditor
            manifest={selectedManifest}
            values={configDraft}
            isDirty={isConfigDirty}
            isSubmitting={isConfigSubmitting}
            isDisabled={isConfigBlocked}
            error={configError}
            warnings={configWarnings}
            status={configStatus}
            onChange={onConfigChange}
            onSubmit={onApplyConfig}
          />
        ) : (
          <pre className="overflow-x-auto rounded-md border bg-background p-2 font-mono text-[11px]">
            {JSON.stringify(selected, null, 2)}
          </pre>
        )}
      </CollapsibleSidebarSection>

      <CollapsibleSidebarSection
        title={t("palette.title")}
        badge={paletteBadge}
        collapsed={paletteCollapsed}
        onToggle={() => {
          setPaletteCollapsed((open) => !open);
        }}
        fill
      >
        {nodes.length > 0 && (
          <div className="flex shrink-0 flex-col gap-2 border-b pb-2">
            <input
              type="text"
              value={search}
              onChange={(event) => {
                onSearchChange(event.target.value);
              }}
              placeholder={t("palette.searchPlaceholder")}
              aria-label={t("palette.searchLabel")}
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
                {t("palette.all")}
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
          <div className="flex flex-col gap-3 py-2">
            {error !== null ? (
              <p className="text-[11px] italic text-muted-foreground">{error}</p>
            ) : nodes.length === 0 ? (
              <p className="text-[11px] italic text-muted-foreground">{t("palette.loading")}</p>
            ) : filteredNodes.length === 0 ? (
              <p className="text-[11px] italic text-muted-foreground">{t("palette.noMatches")}</p>
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
                        title={t("palette.nodeTooltip", { name: manifest.name })}
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
      </CollapsibleSidebarSection>
    </aside>
  );
}
