/**
 * FileDropZone — drag-and-drop overlay + click-to-pick for `.ipynb` files.
 *
 * Reads via `File.text()` and passes the raw text up to the parent, which
 * runs it through `parseNotebook`. Wraps a children render-prop region so
 * the whole app area is a drop target while staying visually unobtrusive
 * until a drag enters.
 */

import { Upload } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useCallback, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n";

export interface FileDropZoneProps {
  onFile: (text: string, name: string) => void;
  children: ReactNode;
}

export function FileDropZone({ onFile, children }: FileDropZoneProps): ReactElement {
  const { t } = useI18n();
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFile = useCallback(
    (file: File): void => {
      void file
        .text()
        .then((text) => {
          onFile(text, file.name);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "unknown error";
          console.error(`FileDropZone: failed to read ${file.name}: ${message}`);
        });
    },
    [onFile],
  );

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);
      const file = event.dataTransfer.files[0];
      if (file !== undefined) {
        readFile(file);
      }
    },
    [readFile],
  );

  const handlePick = useCallback((): void => {
    inputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.[0];
      if (file !== undefined) {
        readFile(file);
      }
      event.target.value = "";
    },
    [readFile],
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: full-app drop zone has no semantic alternative; the visible "Open notebook" button below is the accessible entry point.
    <div
      className="relative flex h-full flex-col"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      <input
        ref={inputRef}
        type="file"
        accept=".ipynb,application/x-ipynb+json"
        onChange={handleInputChange}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />
      <button
        type="button"
        onClick={handlePick}
        className="absolute right-4 bottom-4 inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs shadow-md hover:bg-accent"
      >
        <Upload className="size-3.5" />
        {t("files.openNotebookButton")}
      </button>
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-lg border-2 border-dashed border-primary px-8 py-6 text-center">
            <Upload className="mx-auto mb-2 size-8 text-primary" />
            <p className="text-sm font-medium">{t("files.dropTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("files.dropSubtitle")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
