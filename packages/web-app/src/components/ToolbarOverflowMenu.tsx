/**
 * "…" toolbar overflow menu — secondary workspace actions (downloads,
 * re-ingest, opening the notebook in JupyterLab). Owns its own open state.
 */

import { Download, ExternalLink, MoreHorizontal, RotateCcw } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { openInJupyterLab } from "@/lib/jupyter";

const DEFAULT_JUPYTER_URL = "http://localhost:8888";

const JUPYTER_URL: string = (() => {
  const raw = import.meta.env.VITE_NOTEBOOKFLOW_JUPYTER_URL;
  // Undefined env var -> use default. Explicitly empty string -> opt-out, no button.
  if (raw === undefined) {
    return DEFAULT_JUPYTER_URL;
  }
  return raw.trim();
})();

interface ToolbarOverflowMenuProps {
  /** Active notebook name — the file "Edit in Jupyter" opens. */
  notebookName: string;
  onDownloadWorkspace: () => void;
  onDownloadAll: () => void;
  onReingest: () => void;
}

export function ToolbarOverflowMenu({
  notebookName,
  onDownloadWorkspace,
  onDownloadAll,
  onReingest,
}: ToolbarOverflowMenuProps): ReactElement {
  const { t } = useI18n();
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="px-2"
        onClick={() => {
          setIsOverflowOpen((open) => !open);
        }}
        title={t("app.toolbar.moreActions")}
        aria-label={t("app.toolbar.moreActions")}
      >
        <MoreHorizontal className="size-3.5" />
      </Button>
      {isOverflowOpen && (
        <div className="absolute right-0 top-full z-30 mt-1 w-52 rounded-md border bg-popover text-popover-foreground shadow-md">
          <button
            type="button"
            onClick={() => {
              onDownloadWorkspace();
              setIsOverflowOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-muted/70"
          >
            <Download className="size-3.5" />
            {t("app.toolbar.downloadWorkspace")}
          </button>
          <button
            type="button"
            onClick={() => {
              onDownloadAll();
              setIsOverflowOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-muted/70"
          >
            <Download className="size-3.5" />
            {t("app.toolbar.downloadAllZip")}
          </button>
          <button
            type="button"
            onClick={() => {
              onReingest();
              setIsOverflowOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-muted/70"
          >
            <RotateCcw className="size-3.5" />
            {t("app.toolbar.reingest")}
          </button>
          {JUPYTER_URL !== "" && (
            <button
              type="button"
              onClick={() => {
                openInJupyterLab(JUPYTER_URL, notebookName);
                setIsOverflowOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-muted/70"
            >
              <ExternalLink className="size-3.5" />
              {t("app.toolbar.editInJupyter")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
