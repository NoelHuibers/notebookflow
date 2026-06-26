import { Database, Files, PanelLeftClose, Plus, Upload, X } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DataFile } from "@/lib/EngineClient";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { OpenFileMeta } from "@/types/workspace";

interface FilesRailProps {
  files: OpenFileMeta[];
  activeFileId: string;
  activeDirty: boolean;
  collapsed: boolean;
  dataFiles: DataFile[];
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onOpen: () => void;
  onUploadData: () => void;
  onDeleteData: (name: string) => void;
  onAddDataNode: (name: string) => void;
  onToggleCollapse: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Left-hand workspace explorer: the open notebooks, with open / switch /
// close, plus uploaded data files. Collapses on its own (independently of the
// code pane) to a slim strip — close files without closing code.
export function FilesRail({
  files,
  activeFileId,
  activeDirty,
  collapsed,
  dataFiles,
  onSelect,
  onClose,
  onOpen,
  onUploadData,
  onDeleteData,
  onAddDataNode,
  onToggleCollapse,
}: FilesRailProps): ReactElement {
  const { t } = useI18n();
  if (collapsed) {
    return (
      <div className="flex w-8 shrink-0 flex-col items-center border-r bg-muted/30 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 px-0"
          title={t("files.showFiles")}
          aria-label={t("files.showFiles")}
          onClick={onToggleCollapse}
        >
          <Files className="size-3.5" />
        </Button>
      </div>
    );
  }
  return (
    <aside className="flex w-44 shrink-0 flex-col border-r bg-muted/30">
      <div className="flex items-center justify-between border-b pl-3 pr-1.5 py-2 text-xs text-muted-foreground">
        <span className="font-medium">{t("files.files")}</span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 px-0"
            title={t("files.openNotebook")}
            aria-label={t("files.openNotebook")}
            onClick={onOpen}
          >
            <Plus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 px-0"
            title={t("files.hideFiles")}
            aria-label={t("files.hideFiles")}
            onClick={onToggleCollapse}
          >
            <PanelLeftClose className="size-3.5" />
          </Button>
        </div>
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
                        aria-label={t("files.unsavedChanges")}
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
                      aria-label={t("files.closeFile", { name: file.name })}
                      title={t("files.closeFile", { name: file.name })}
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

      <div className="border-t">
        <div className="flex items-center justify-between pl-3 pr-1.5 py-1.5 text-[11px] text-muted-foreground">
          <span className="font-medium uppercase tracking-wide">{t("files.data")}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 px-0"
            title={t("files.uploadData")}
            aria-label={t("files.uploadDataAria")}
            onClick={onUploadData}
          >
            <Upload className="size-3.5" />
          </Button>
        </div>
        {dataFiles.length === 0 ? (
          <p className="px-3 pb-2 text-[10px] italic leading-snug text-muted-foreground">
            {t("files.dataEmptyPrefix")} <code className="font-mono">read_csv("name.csv")</code>.
          </p>
        ) : (
          <ul className="flex max-h-40 flex-col overflow-y-auto p-1">
            {dataFiles.map((dataFile) => (
              <li
                key={dataFile.name}
                className="group flex items-center gap-1.5 rounded px-2 py-1 text-[12px] hover:bg-muted/60"
              >
                <span
                  className="flex min-w-0 flex-1 items-center gap-1.5"
                  title={`${dataFile.name} · ${formatBytes(dataFile.size)}`}
                >
                  <Database className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-[11px]">{dataFile.name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onAddDataNode(dataFile.name);
                  }}
                  className="shrink-0 rounded text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                  aria-label={t("files.addNodeFor", { name: dataFile.name })}
                  title={t("files.addLoadCsvTitle")}
                >
                  <Plus className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDeleteData(dataFile.name);
                  }}
                  className="shrink-0 rounded text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                  aria-label={t("files.deleteFile", { name: dataFile.name })}
                  title={t("files.deleteFile", { name: dataFile.name })}
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
