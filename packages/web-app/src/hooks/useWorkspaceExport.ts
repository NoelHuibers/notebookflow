/**
 * Workspace export seams — collect the full workspace document (files +
 * canvas layout + panel UI state) and the two download handlers. The cloud
 * save reuses `collectWorkspaceDocument`.
 */

import type { CanvasGroupPosition } from "@notebookflow/graph-canvas";
import type { TFunction } from "i18next";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback } from "react";

import { formatError } from "@/lib/errors";
import type { ParsedWorkspace, WorkspaceUiState } from "@/lib/notebooksApi";
import { serializeWorkspace } from "@/lib/notebooksApi";
import { collectWorkspaceFiles } from "@/lib/workspaceExport";
import {
  downloadWorkspaceDocument,
  downloadWorkspaceZip,
  type WorkspaceFile,
} from "@/lib/workspaceZip";
import type {
  CellOutputsByCell,
  FileSnapshot,
  LoadedNotebook,
  OpenFileMeta,
} from "@/types/workspace";

export interface UseWorkspaceExportOptions {
  openFiles: OpenFileMeta[];
  activeFileId: string;
  notebook: LoadedNotebook;
  outputsByCell: CellOutputsByCell;
  snapshotsRef: MutableRefObject<Map<string, FileSnapshot>>;
  canvasGroupPositionsByFileId: Record<string, CanvasGroupPosition>;
  setBaselineSources: Dispatch<SetStateAction<string[]>>;
  /** Panel layout's UI-state collector (usePanelLayout.collectUiState). */
  collectUiState: () => WorkspaceUiState;
  t: TFunction;
  setError: Dispatch<SetStateAction<string | null>>;
}

export interface WorkspaceExport {
  /** Full workspace document — files + canvas layout + panel UI state. */
  collectWorkspaceDocument: () => ParsedWorkspace;
  /** Export every open file's .ipynb as one zip. */
  handleDownloadAll: () => Promise<void>;
  /** Download the whole workspace as a single .notebookflow.json document. */
  handleDownloadWorkspace: () => void;
}

export function useWorkspaceExport({
  openFiles,
  activeFileId,
  notebook,
  outputsByCell,
  snapshotsRef,
  canvasGroupPositionsByFileId,
  setBaselineSources,
  collectUiState,
  t,
  setError,
}: UseWorkspaceExportOptions): WorkspaceExport {
  // Export every open file's .ipynb as one zip — a single "Download" is
  // ambiguous once the workspace spans multiple files. The active file carries
  // its live cells + run outputs; inactive files come from their snapshots.
  // Serialize every open file's .ipynb — shared by zip export and cloud save.
  const collectFiles = useCallback(
    (): WorkspaceFile[] =>
      collectWorkspaceFiles(openFiles, activeFileId, notebook, outputsByCell, snapshotsRef.current),
    [openFiles, activeFileId, notebook, outputsByCell, snapshotsRef],
  );

  const collectWorkspaceDocument = useCallback((): ParsedWorkspace => {
    const groupPositions: Record<string, CanvasGroupPosition> = {};
    for (const file of openFiles) {
      const position = canvasGroupPositionsByFileId[file.id];
      if (position !== undefined) {
        groupPositions[file.id === activeFileId ? notebook.name : file.name] = position;
      }
    }
    return {
      files: collectFiles(),
      activeFileName: notebook.name,
      layout: {
        groupPositions,
      },
      ui: collectUiState(),
    };
  }, [
    openFiles,
    activeFileId,
    notebook.name,
    canvasGroupPositionsByFileId,
    collectFiles,
    collectUiState,
  ]);

  const handleDownloadAll = useCallback(async (): Promise<void> => {
    try {
      await downloadWorkspaceZip(collectFiles());
      setBaselineSources(notebook.cells.map((cell) => cell.source));
    } catch (err: unknown) {
      setError(t("app.errors.downloadFailed", { message: formatError(t, err) }));
    }
  }, [collectFiles, notebook.cells, t, setBaselineSources, setError]);

  const handleDownloadWorkspace = useCallback((): void => {
    downloadWorkspaceDocument(serializeWorkspace(collectWorkspaceDocument()));
    setBaselineSources(notebook.cells.map((cell) => cell.source));
  }, [collectWorkspaceDocument, notebook.cells, setBaselineSources]);

  return {
    collectWorkspaceDocument,
    handleDownloadAll,
    handleDownloadWorkspace,
  };
}
