import { Cloud, Trash2, X } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import type { NotebookSummary } from "@/lib/notebooksApi";

interface CloudNotebooksDialogProps {
  notebooks: NotebookSummary[];
  currentName: string;
  cloudId: string | null;
  busy: boolean;
  error: string | null;
  onSave: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function CloudNotebooksDialog({
  notebooks,
  currentName,
  cloudId,
  busy,
  error,
  onSave,
  onOpen,
  onDelete,
  onClose,
}: CloudNotebooksDialogProps): ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-6 pt-[12vh] backdrop-blur">
      <div className="w-full max-w-md rounded-md border bg-card p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Cloud className="size-4 text-primary" />
            My notebooks
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

        <Button
          variant="outline"
          size="sm"
          className="mb-3 w-full"
          disabled={busy}
          onClick={onSave}
        >
          {busy
            ? "Saving…"
            : cloudId
              ? `Update “${currentName}”`
              : `Save “${currentName}” to cloud`}
        </Button>

        {error !== null && <p className="mb-2 text-[12px] text-destructive">{error}</p>}

        {notebooks.length === 0 ? (
          <p className="py-4 text-center text-[12px] text-muted-foreground">
            No saved notebooks yet.
          </p>
        ) : (
          <ul className="flex max-h-[40vh] flex-col gap-1 overflow-auto">
            {notebooks.map((nb) => (
              <li
                key={nb.id}
                className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] hover:bg-muted ${
                  nb.id === cloudId ? "bg-muted" : ""
                }`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col items-start text-left"
                  onClick={() => onOpen(nb.id)}
                  disabled={busy}
                >
                  <span className="truncate font-medium">{nb.name}</span>
                  <span className="text-muted-foreground">
                    {new Date(nb.updatedAt).toLocaleString()}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1.5 text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  onClick={() => onDelete(nb.id)}
                  aria-label={`Delete ${nb.name}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
