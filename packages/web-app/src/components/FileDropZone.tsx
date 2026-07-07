/**
 * FileDropZone — drag-and-drop overlay + click-to-pick for `.ipynb` files.
 *
 * Reads via `File.text()` and passes the raw text up to the parent, which
 * runs it through `parseNotebook`. Wraps a children render-prop region so
 * the whole app area is a drop target while staying visually unobtrusive
 * until a drag enters.
 */

import { NODE_DRAG_MIME } from "@notebookflow/graph-canvas";
import { Upload } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useCallback, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n";

/** True when the drag carries OS files (e.g. Finder), not in-app palette drags. */
export function isNotebookFileDrag(event: Pick<React.DragEvent, "dataTransfer">): boolean {
  const types = event.dataTransfer?.types;
  if (types === undefined) {
    return false;
  }
  const typeList = Array.from(types);
  if (typeList.includes(NODE_DRAG_MIME)) {
    return false;
  }
  return typeList.includes("Files");
}

export interface FileDropZoneProps {
  onFile: (text: string, name: string) => void;
  children: ReactNode;
}

export function FileDropZone({ onFile, children }: FileDropZoneProps): ReactElement {
  const { t } = useI18n();
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

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
    if (!isNotebookFileDrag(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    if (dragDepthRef.current === 0) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    if (!isNotebookFileDrag(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      if (!isNotebookFileDrag(event)) {
        return;
      }
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

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: full-app drop zone has no semantic alternative; notebook toolbar buttons provide the accessible entry points.
    <div
      className="relative flex h-full flex-col"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
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
