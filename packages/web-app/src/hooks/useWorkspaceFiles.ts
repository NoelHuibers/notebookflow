/**
 * Multi-file workspace core — the active notebook, the open-file rail,
 * frozen snapshots of inactive files, per-cell run outputs, canvas group
 * positions, and the open/create/switch/close file operations.
 *
 * Cross-cutting App state (run/canvas transients, panel layout, error banner,
 * cloud linkage) flows in as callbacks; the SyncEngine wiring stays in App and
 * reaches the workspace through the returned setters and refs.
 */

import type { CanvasGroupPosition } from "@notebookflow/graph-canvas";
import type { NotebookCell } from "@notebookflow/graph-canvas/sync";
import type { TFunction } from "i18next";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatError } from "@/lib/errors";
import { extractOutputsByCell, parseNotebook } from "@/lib/notebook";
import { type ParsedWorkspace, parseWorkspace, type WorkspaceUiState } from "@/lib/notebooksApi";
import {
  createBlankNotebook,
  createInitialWorkspaceFiles,
  firstInitialWorkspaceFile,
  type InitialWorkspaceFile,
  isLikelyWorkspaceFilename,
  makeFileId,
  uniqueUntitledNotebookName,
} from "@/lib/workspaceFiles";
import type { WorkspacePatchLookup } from "@/lib/workspacePatches";
import type {
  CellOutputsByCell,
  FileSnapshot,
  LoadedNotebook,
  OpenFileMeta,
} from "@/types/workspace";

export interface UseWorkspaceFilesOptions {
  /** Reset App-owned transient run/edit UI whenever the active document changes. */
  onDocumentChange: () => void;
  /** Extra App-side reset after creating a blank notebook (focus its first cell). */
  onNotebookCreated: () => void;
  /** Apply the persisted panel-layout UI state from a loaded workspace document. */
  applyUi: (ui: WorkspaceUiState | undefined) => void;
  /** Surface a load error in App's banner (null clears it). */
  onError: (message: string | null) => void;
  /** Detach cloud linkage when the workspace/notebook is replaced wholesale. */
  onWorkspaceReplaced: () => void;
  t: TFunction;
}

export interface WorkspaceFiles {
  notebook: LoadedNotebook;
  setNotebook: Dispatch<SetStateAction<LoadedNotebook>>;
  openFiles: OpenFileMeta[];
  activeFileId: string;
  activeFileIdRef: MutableRefObject<string>;
  /** Identity of the open-file set; changes only when a file is opened/closed. */
  openFilesKey: string;
  setWorkspaceRevision: Dispatch<SetStateAction<number>>;
  setBaselineSources: Dispatch<SetStateAction<string[]>>;
  snapshotsRef: MutableRefObject<Map<string, FileSnapshot>>;
  workspacePatchLookupRef: MutableRefObject<WorkspacePatchLookup>;
  fileHandleRef: MutableRefObject<FileSystemFileHandle | null>;
  outputsByCell: CellOutputsByCell;
  replaceActiveOutputsByCell: (next: CellOutputsByCell) => void;
  updateOutputsForFile: (
    fileId: string,
    update: (current: CellOutputsByCell) => CellOutputsByCell,
  ) => void;
  updateOutputsForNotebookPath: (
    notebookPath: string,
    update: (current: CellOutputsByCell) => CellOutputsByCell,
  ) => void;
  clearOutputsForOpenFiles: () => void;
  canvasGroupPositions: Record<string, CanvasGroupPosition>;
  canvasGroupPositionsByFileId: Record<string, CanvasGroupPosition>;
  handleGroupPositionChange: (groupId: string, position: CanvasGroupPosition) => void;
  cellsByPath: Map<string, NotebookCell[]>;
  applyWorkspaceDocument: (workspace: ParsedWorkspace) => void;
  switchToFile: (targetId: string) => void;
  handleFile: (text: string, name: string) => void;
  handleCreateNotebook: () => void;
  closeFile: (id: string) => void;
  triggerOpenFile: () => void;
  isDirty: boolean;
}

export function useWorkspaceFiles({
  onDocumentChange,
  onNotebookCreated,
  applyUi,
  onError,
  onWorkspaceReplaced,
  t,
}: UseWorkspaceFilesOptions): WorkspaceFiles {
  const initialWorkspaceRef = useRef<InitialWorkspaceFile[] | null>(null);
  if (initialWorkspaceRef.current === null) {
    initialWorkspaceRef.current = createInitialWorkspaceFiles();
  }
  const initialWorkspace = initialWorkspaceRef.current;
  const firstInitialFile = firstInitialWorkspaceFile(initialWorkspace);
  const [notebook, setNotebook] = useState<LoadedNotebook>(() => firstInitialFile.notebook);
  // Multi-file workspace. The active file's live content is `notebook`; other
  // open files freeze into snapshotsRef until switched back to.
  const [openFiles, setOpenFiles] = useState<OpenFileMeta[]>(() => [
    ...initialWorkspace.map(({ id, notebook: fileNotebook }) => ({
      id,
      name: fileNotebook.name,
    })),
  ]);
  const [activeFileId, setActiveFileId] = useState<string>(() => firstInitialFile.id);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const snapshotsRef = useRef<Map<string, FileSnapshot>>(
    new Map(
      initialWorkspace.slice(1).map(({ id, notebook: fileNotebook }) => [
        id,
        {
          cells: fileNotebook.cells,
          doc: fileNotebook.doc,
          baseline: fileNotebook.cells.map((cell) => cell.source),
          fileHandle: null,
          outputsByCell: extractOutputsByCell(fileNotebook.doc),
        },
      ]),
    ),
  );
  const workspacePatchLookupRef = useRef<WorkspacePatchLookup>({
    openFiles,
    activeFileId,
    activeNotebookName: notebook.name,
    snapshots: snapshotsRef.current,
  });
  workspacePatchLookupRef.current = {
    openFiles,
    activeFileId,
    activeNotebookName: notebook.name,
    snapshots: snapshotsRef.current,
  };
  const [outputsByCell, setOutputsByCell] = useState<CellOutputsByCell>(() =>
    extractOutputsByCell(firstInitialFile.notebook.doc),
  );
  const [canvasGroupPositionsByFileId, setCanvasGroupPositionsByFileId] = useState<
    Record<string, CanvasGroupPosition>
  >({});
  const [baselineSources, setBaselineSources] = useState<string[]>(() =>
    firstInitialFile.notebook.cells.map((cell) => cell.source),
  );
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const activeFileIdRef = useRef(activeFileId);
  const openFilesRef = useRef(openFiles);
  const outputsByCellRef = useRef(outputsByCell);
  activeFileIdRef.current = activeFileId;
  openFilesRef.current = openFiles;
  outputsByCellRef.current = outputsByCell;

  const replaceActiveOutputsByCell = useCallback((next: CellOutputsByCell): void => {
    outputsByCellRef.current = next;
    setOutputsByCell(next);
  }, []);

  const updateOutputsForFile = useCallback(
    (fileId: string, update: (current: CellOutputsByCell) => CellOutputsByCell): void => {
      if (fileId === activeFileIdRef.current) {
        setOutputsByCell((current) => {
          const next = update(current);
          outputsByCellRef.current = next;
          return next;
        });
        return;
      }
      const snapshot = snapshotsRef.current.get(fileId);
      if (snapshot === undefined) {
        return;
      }
      snapshotsRef.current.set(fileId, {
        ...snapshot,
        outputsByCell: update(snapshot.outputsByCell),
      });
    },
    [],
  );

  const updateOutputsForNotebookPath = useCallback(
    (notebookPath: string, update: (current: CellOutputsByCell) => CellOutputsByCell): void => {
      const file = openFilesRef.current.find((candidate) => candidate.name === notebookPath);
      if (file === undefined) {
        return;
      }
      updateOutputsForFile(file.id, update);
    },
    [updateOutputsForFile],
  );

  const clearOutputsForOpenFiles = useCallback((): void => {
    for (const file of openFilesRef.current) {
      if (file.id === activeFileIdRef.current) {
        continue;
      }
      const snapshot = snapshotsRef.current.get(file.id);
      if (snapshot !== undefined) {
        snapshotsRef.current.set(file.id, { ...snapshot, outputsByCell: {} });
      }
    }
    replaceActiveOutputsByCell({});
  }, [replaceActiveOutputsByCell]);

  const canvasGroupPositions = useMemo<Record<string, CanvasGroupPosition>>(() => {
    const positions: Record<string, CanvasGroupPosition> = {};
    for (const file of openFiles) {
      const position = canvasGroupPositionsByFileId[file.id];
      if (position === undefined) {
        continue;
      }
      positions[file.id === activeFileId ? notebook.name : file.name] = position;
    }
    return positions;
  }, [openFiles, activeFileId, notebook.name, canvasGroupPositionsByFileId]);

  const handleGroupPositionChange = useCallback(
    (groupId: string, position: CanvasGroupPosition) => {
      const activeFile = openFilesRef.current.find(
        (candidate) => candidate.id === activeFileIdRef.current,
      );
      const file =
        groupId === notebook.name && activeFile !== undefined
          ? activeFile
          : openFilesRef.current.find((candidate) => candidate.name === groupId);
      if (file === undefined) {
        return;
      }
      setCanvasGroupPositionsByFileId((current) => {
        const previous = current[file.id];
        if (previous?.x === position.x && previous.y === position.y) {
          return current;
        }
        return { ...current, [file.id]: position };
      });
    },
    [notebook.name],
  );

  // Cells of every open file, keyed by notebook path (= file name). The active
  // file is live; inactive files come from their frozen snapshots. Drives both
  // the workspace ingest and the composed pipeline's per-node source lookup.
  const cellsByPath = useMemo<Map<string, NotebookCell[]>>(() => {
    void workspaceRevision;
    const map = new Map<string, NotebookCell[]>();
    for (const file of openFiles) {
      if (file.id === activeFileId) {
        map.set(file.name, notebook.cells);
      } else {
        const snap = snapshotsRef.current.get(file.id);
        if (snap !== undefined) {
          map.set(file.name, snap.cells);
        }
      }
    }
    return map;
    // A rename of the active file flows through openFiles, so it's covered here.
  }, [openFiles, activeFileId, notebook.cells, workspaceRevision]);

  // Identity of the open-file set; changes only when a file is opened/closed,
  // not on edits or switches.
  const openFilesKey = openFiles.map((f) => f.id).join("|");

  // Keep the Files rail label in sync when the active notebook is renamed
  // (e.g. applying a Compose draft swaps in a new filename).
  useEffect(() => {
    setOpenFiles((prev) =>
      prev.map((f) =>
        f.id === activeFileId && f.name !== notebook.name ? { ...f, name: notebook.name } : f,
      ),
    );
  }, [notebook.name, activeFileId]);

  const applyWorkspaceDocument = useCallback(
    (workspace: ParsedWorkspace): void => {
      const parsed = workspace.files.map((file) => ({
        id: makeFileId(),
        name: file.name,
        ...parseNotebook(file.json),
      }));
      const first = parsed[0];
      if (first === undefined) {
        throw new Error(t("app.errors.workspaceEmpty"));
      }
      const active =
        workspace.activeFileName === undefined
          ? first
          : (parsed.find((file) => file.name === workspace.activeFileName) ?? first);
      snapshotsRef.current.clear();
      for (const file of parsed) {
        if (file.id === active.id) {
          continue;
        }
        snapshotsRef.current.set(file.id, {
          cells: file.cells,
          doc: file.doc,
          baseline: file.cells.map((cell) => cell.source),
          fileHandle: null,
          outputsByCell: extractOutputsByCell(file.doc),
        });
      }
      const positionsByFileId: Record<string, CanvasGroupPosition> = {};
      const savedPositions = workspace.layout?.groupPositions ?? {};
      for (const file of parsed) {
        const position = savedPositions[file.name];
        if (position !== undefined) {
          positionsByFileId[file.id] = position;
        }
      }
      setCanvasGroupPositionsByFileId(positionsByFileId);
      setOpenFiles(parsed.map((file) => ({ id: file.id, name: file.name })));
      setActiveFileId(active.id);
      setNotebook({ name: active.name, cells: active.cells, doc: active.doc });
      setBaselineSources(active.cells.map((cell) => cell.source));
      fileHandleRef.current = null;
      replaceActiveOutputsByCell(extractOutputsByCell(active.doc));
      onDocumentChange();
      applyUi(workspace.ui);
    },
    [applyUi, replaceActiveOutputsByCell, onDocumentChange, t],
  );

  // Freeze the active file's working state so it can be restored when the
  // user switches back to it.
  const snapshotActive = useCallback((): void => {
    snapshotsRef.current.set(activeFileId, {
      cells: notebook.cells,
      doc: notebook.doc,
      baseline: baselineSources,
      fileHandle: fileHandleRef.current,
      outputsByCell: outputsByCellRef.current,
    });
  }, [activeFileId, notebook, baselineSources]);

  const switchToFile = useCallback(
    (targetId: string): void => {
      if (targetId === activeFileId) {
        return;
      }
      snapshotActive();
      const snap = snapshotsRef.current.get(targetId);
      const targetName = openFiles.find((f) => f.id === targetId)?.name ?? "notebook.ipynb";
      if (snap !== undefined) {
        setNotebook({ name: targetName, cells: snap.cells, doc: snap.doc });
        setBaselineSources(snap.baseline);
        fileHandleRef.current = snap.fileHandle;
        replaceActiveOutputsByCell(snap.outputsByCell);
        snapshotsRef.current.delete(targetId);
      }
      onDocumentChange();
      setActiveFileId(targetId);
    },
    [activeFileId, openFiles, snapshotActive, onDocumentChange, replaceActiveOutputsByCell],
  );

  const handleFile = useCallback(
    (text: string, name: string): void => {
      if (isLikelyWorkspaceFilename(name)) {
        try {
          applyWorkspaceDocument(parseWorkspace(text));
          onWorkspaceReplaced();
          onError(null);
          return;
        } catch (err: unknown) {
          const message = formatError(t, err);
          onError(t("app.errors.loadFailed", { name, message }));
          return;
        }
      }
      try {
        const parsed = parseNotebook(text);
        // Re-opening an already-open file just switches to it.
        const existing = openFiles.find((f) => f.name === name);
        if (existing !== undefined) {
          switchToFile(existing.id);
          return;
        }
        snapshotActive();
        const id = makeFileId();
        setOpenFiles((prev) => [...prev, { id, name }]);
        setActiveFileId(id);
        setNotebook({ name, cells: parsed.cells, doc: parsed.doc });
        setBaselineSources(parsed.cells.map((cell) => cell.source));
        fileHandleRef.current = null;
        replaceActiveOutputsByCell(extractOutputsByCell(parsed.doc));
        onDocumentChange();
        onError(null);
      } catch (err: unknown) {
        const message = formatError(t, err);
        onError(t("app.errors.loadFailed", { name, message }));
      }
    },
    [
      applyWorkspaceDocument,
      openFiles,
      snapshotActive,
      switchToFile,
      onDocumentChange,
      onError,
      onWorkspaceReplaced,
      replaceActiveOutputsByCell,
      t,
    ],
  );

  const handleCreateNotebook = useCallback((): void => {
    snapshotActive();
    const next = createBlankNotebook(uniqueUntitledNotebookName(openFiles));
    const id = makeFileId();
    setOpenFiles((prev) => [...prev, { id, name: next.name }]);
    setActiveFileId(id);
    setNotebook(next);
    setBaselineSources(next.cells.map((cell) => cell.source));
    fileHandleRef.current = null;
    replaceActiveOutputsByCell({});
    onDocumentChange();
    onNotebookCreated();
    // Detach from any opened cloud record: the next "Save to cloud" should
    // create a new one, not silently overwrite what was open before.
    onWorkspaceReplaced();
    onError(null);
  }, [
    openFiles,
    snapshotActive,
    onDocumentChange,
    onNotebookCreated,
    onError,
    onWorkspaceReplaced,
    replaceActiveOutputsByCell,
  ]);

  const closeFile = useCallback(
    (id: string): void => {
      if (openFiles.length <= 1) {
        return; // keep at least one file open
      }
      if (id === activeFileId) {
        const idx = openFiles.findIndex((f) => f.id === id);
        const neighbor = openFiles[idx + 1] ?? openFiles[idx - 1];
        if (neighbor !== undefined) {
          switchToFile(neighbor.id);
        }
      }
      snapshotsRef.current.delete(id);
      setCanvasGroupPositionsByFileId((current) => {
        if (current[id] === undefined) {
          return current;
        }
        const next = { ...current };
        delete next[id];
        return next;
      });
      setOpenFiles((prev) => prev.filter((f) => f.id !== id));
    },
    [openFiles, activeFileId, switchToFile],
  );

  // Open the OS file picker and load the chosen notebook into the workspace.
  const triggerOpenFile = useCallback((): void => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ipynb,.notebookflow.json,.notebookflow,.nfw,application/json";
    input.onchange = (): void => {
      const file = input.files?.[0];
      if (file === undefined) {
        return;
      }
      void file.text().then((text) => {
        handleFile(text, file.name);
      });
    };
    input.click();
  }, [handleFile]);

  const isDirty = useMemo(() => {
    if (notebook.cells.length !== baselineSources.length) {
      return true;
    }
    for (let i = 0; i < notebook.cells.length; i++) {
      if (notebook.cells[i]?.source !== baselineSources[i]) {
        return true;
      }
    }
    return false;
  }, [notebook.cells, baselineSources]);

  return {
    notebook,
    setNotebook,
    openFiles,
    activeFileId,
    activeFileIdRef,
    openFilesKey,
    setWorkspaceRevision,
    setBaselineSources,
    snapshotsRef,
    workspacePatchLookupRef,
    fileHandleRef,
    outputsByCell,
    replaceActiveOutputsByCell,
    updateOutputsForFile,
    updateOutputsForNotebookPath,
    clearOutputsForOpenFiles,
    canvasGroupPositions,
    canvasGroupPositionsByFileId,
    handleGroupPositionChange,
    cellsByPath,
    applyWorkspaceDocument,
    switchToFile,
    handleFile,
    handleCreateNotebook,
    closeFile,
    triggerOpenFile,
    isDirty,
  };
}
