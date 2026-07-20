/**
 * Standalone web app — fully functional NotebookFlow client.
 *
 * - Drop / pick an `.ipynb` or workspace file to load cells into the editor + canvas.
 * - Edit cells inline (CodeMirror); the SyncEngine re-ingests after
 *   a 300 ms debounce so the canvas reflects marker edits live.
 * - Click Run to dispatch the current graph over WebSocket to the engine
 *   (default `ws://localhost:8765/ws`; production override via
 *   ``VITE_NOTEBOOKFLOW_ENGINE_URL``). Execution events stream in.
 * - Click Download to save the patched `.ipynb` or the full workspace back to disk.
 */

import type {
  AskPaletteLabels,
  ComposeDialogLabels,
  ExplanationPanelLabels,
} from "@notebookflow/app-core";
import {
  AskPalette,
  buildGenerationStatus,
  buildPipelineDef,
  ComposeDialog,
  defaultAskPaletteLabels,
  defaultComposeDialogLabels,
  defaultExplanationPanelLabels,
  ExplanationPanel,
  extractSourceFilename,
  renderEvent,
  stripMarkerLine,
} from "@notebookflow/app-core";
import type {
  CanvasLabels,
  GraphModel,
  NodeManifestDef,
  RunSummary,
  RuntimeState,
  WireModel,
} from "@notebookflow/graph-canvas";
import {
  addManifestNode,
  Canvas,
  configValuesEqual,
  defaultCanvasLabels,
  hasMissingRequiredConfig,
  readNotebookflowMetadata,
  resolveNodeConfig,
  sanitizeConfigForManifest,
  writeNotebookflowMetadata,
} from "@notebookflow/graph-canvas";
import type { CellPatch, NotebookCell } from "@notebookflow/graph-canvas/sync";
import { SyncEngine } from "@notebookflow/graph-canvas/sync";
import {
  FilePlus,
  PanelBottom,
  PanelBottomClose,
  PanelLeftOpen,
  PanelRight,
  PanelRightClose,
  Upload,
} from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { CanvasSidebar } from "@/components/CanvasSidebar";
import { CellList } from "@/components/CellList";
import { CellPaneFooter } from "@/components/CellPaneFooter";
import type { CellKind } from "@/components/CellToolbar";
import { CellToolbar } from "@/components/CellToolbar";
import { CloudNotebooksDialog } from "@/components/CloudNotebooksDialog";
import { FileDropZone } from "@/components/FileDropZone";
import { FilesRail } from "@/components/FilesRail";
import { InspectorPanel } from "@/components/InspectorPanel";
import { PaneDivider } from "@/components/PaneDivider";
import { SettingsDialog } from "@/components/SettingsDialog";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { TriggersDialog } from "@/components/TriggersDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type CanvasSelectionSync, useCanvasSelectionSync } from "@/hooks/useCanvasSelectionSync";
import { useCloudNotebooks } from "@/hooks/useCloudNotebooks";
import { usePanelLayout } from "@/hooks/usePanelLayout";
import { useWorkspaceExport } from "@/hooks/useWorkspaceExport";
import { useWorkspaceFiles } from "@/hooks/useWorkspaceFiles";
import { deleteAccount as deleteRemoteAccount, downloadAccountData } from "@/lib/accountDataApi";
import { authClient, useSession } from "@/lib/auth-client";
import { applyCellPatch } from "@/lib/cellPatch";
import type {
  AskAnswer,
  DataFile,
  EngineEvent,
  PipelineDef,
  PipelineExplanation,
  PipelineProposal,
  TriggerSpec,
} from "@/lib/EngineClient";
import { EngineClient } from "@/lib/EngineClient";
import { formatError } from "@/lib/errors";
import { pickSaveFileHandle, writeFileHandle } from "@/lib/fileSystemAccess";
import { useI18n } from "@/lib/i18n";
import type { IpynbDoc } from "@/lib/notebook";
import { serializeNotebook, toIpynbCell } from "@/lib/notebook";
import { sortPalette } from "@/lib/palette";
import { deleteProviderKey, getProviderKey, saveProviderKey } from "@/lib/providerKeyApi";
import type { UserSettings } from "@/lib/settings";
import { applyTheme, readUserSettings, SETTINGS_STORAGE_KEY } from "@/lib/settings";
import { cn, isTypingTarget } from "@/lib/utils";
import { shiftOutputsAfterDelete, shiftOutputsAfterInsert } from "@/lib/workspaceFiles";
import { applyPatchToSnapshot, resolveWorkspacePatchTarget } from "@/lib/workspacePatches";

const EMPTY_GRAPH: GraphModel = { nodes: {}, groups: {}, wires: {} };
// Cell-patches inspector panel is a dev-only debugging view.
const DEV_MODE = import.meta.env.DEV;

export function App(): ReactElement {
  const { t } = useI18n();
  // Translate the shared graph-canvas labels from the `canvas` namespace. Keys
  // mirror graph-canvas's CanvasLabels, so iterate the defaults and look each up.
  const canvasLabels = useMemo<CanvasLabels>(() => {
    const out = {} as CanvasLabels;
    for (const key of Object.keys(defaultCanvasLabels) as (keyof CanvasLabels)[]) {
      out[key] = t(`canvas.${key}`);
    }
    return out;
  }, [t]);
  // Same pattern for the shared AI dialogs (components live in app-core; the
  // `ask` / `compose` / `explanation` catalogs here stay the translation
  // source and mirror the label keys 1:1).
  const askLabels = useMemo<AskPaletteLabels>(() => {
    const out = {} as AskPaletteLabels;
    for (const key of Object.keys(defaultAskPaletteLabels) as (keyof AskPaletteLabels)[]) {
      out[key] = t(`ask.${key}`);
    }
    return out;
  }, [t]);
  const composeLabels = useMemo<ComposeDialogLabels>(() => {
    const out = {} as ComposeDialogLabels;
    for (const key of Object.keys(defaultComposeDialogLabels) as (keyof ComposeDialogLabels)[]) {
      out[key] = t(`compose.${key}`);
    }
    return out;
  }, [t]);
  const explanationLabels = useMemo<ExplanationPanelLabels>(() => {
    const out = {} as ExplanationPanelLabels;
    for (const key of Object.keys(
      defaultExplanationPanelLabels,
    ) as (keyof ExplanationPanelLabels)[]) {
      out[key] = t(`explanation.${key}`);
    }
    return out;
  }, [t]);
  // Panel layout (split ratios, collapse flags, divider drag handlers, style
  // memos) lives in usePanelLayout; App consumes what its JSX/callbacks need.
  const {
    isFilesCollapsed,
    setIsFilesCollapsed,
    isCellsCollapsed,
    setIsCellsCollapsed,
    isInspectorCollapsed,
    setIsInspectorCollapsed,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    showMinimap,
    setShowMinimap,
    contentRef,
    topPaneRef,
    canvasPaneRef,
    canvasBodyRef,
    contentStyle,
    topPaneStyle,
    canvasBodyStyle,
    toggleSidebar,
    handleVerticalDividerPointerDown,
    handleVerticalDividerKeyDown,
    handleHorizontalDividerPointerDown,
    handleHorizontalDividerKeyDown,
    handleSidebarDividerPointerDown,
    handleSidebarDividerKeyDown,
    applyWorkspaceUi,
    collectUiState,
  } = usePanelLayout();
  const [graph, setGraph] = useState<GraphModel>(EMPTY_GRAPH);
  const [patches, setPatches] = useState<CellPatch[]>([]);
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [runtimeByNode, setRuntimeByNode] = useState<Record<string, RuntimeState>>({});
  // Post-run output row counts, keyed by node id. Merged with the static
  // filename map (derived from cell source) into the canvas meta line.
  const [rowsByNode, setRowsByNode] = useState<Record<string, number>>({});
  const [streamingCellIndex, setStreamingCellIndex] = useState<number | null>(null);
  const [streamingNotebookPath, setStreamingNotebookPath] = useState<string | null>(null);
  const [timingByNode, setTimingByNode] = useState<Record<string, number>>({});
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [cellClipboard, setCellClipboard] = useState<NotebookCell | null>(null);
  const [isAddCellMenuOpen, setIsAddCellMenuOpen] = useState(false);
  const [definedByCell, setDefinedByCell] = useState<string[][]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState<Record<string, string>>({});
  const [configError, setConfigError] = useState<string | null>(null);
  const [configWarnings, setConfigWarnings] = useState<string[]>([]);
  const [configStatus, setConfigStatus] = useState<string | null>(null);
  const [isConfigSubmitting, setIsConfigSubmitting] = useState(false);
  const [paletteNodes, setPaletteNodes] = useState<NodeManifestDef[]>([]);
  const [paletteError, setPaletteError] = useState<string | null>(null);
  const [paletteSearch, setPaletteSearch] = useState("");
  const [paletteTagFilter, setPaletteTagFilter] = useState<Set<NodeManifestDef["tag"]>>(
    () => new Set(),
  );
  const [settings, setSettings] = useState<UserSettings>(() => readUserSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [explanation, setExplanation] = useState<PipelineExplanation | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [composePrompt, setComposePrompt] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [composeResult, setComposeResult] = useState<PipelineProposal | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [isAskOpen, setIsAskOpen] = useState(false);
  const [askPrompt, setAskPrompt] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [askResult, setAskResult] = useState<AskAnswer | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isTriggersOpen, setIsTriggersOpen] = useState(false);
  // Server-side encrypted provider key (#61): "saved" once one exists in the account.
  const [accountKeyState, setAccountKeyState] = useState<"none" | "saved" | "saving">("none");
  const [triggers, setTriggers] = useState<TriggerSpec[]>([]);
  const [triggersError, setTriggersError] = useState<string | null>(null);
  const [isLoadingTriggers, setIsLoadingTriggers] = useState(false);
  const engineRef = useRef<SyncEngine | null>(null);
  const clientRef = useRef<EngineClient>(
    settings.engineUrlOverride === ""
      ? new EngineClient()
      : new EngineClient(settings.engineUrlOverride),
  );

  // BetterAuth session (#59). When signed in, mint a short-lived JWT for the
  // engine; signed out, fall back to the engine's static self-host token.
  const session = useSession();
  const [engineJwt, setEngineJwt] = useState("");
  useEffect(() => {
    if (!session.data) {
      setEngineJwt("");
      return;
    }
    let cancelled = false;
    fetch("/api/auth/token", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { token?: string } | null) => {
        if (!cancelled) setEngineJwt(body?.token ?? "");
      })
      .catch(() => {
        if (!cancelled) setEngineJwt("");
      });
    return () => {
      cancelled = true;
    };
  }, [session.data]);

  // Rebuild the EngineClient when the engine URL changes, and (re)apply the
  // bring-your-own-key credentials whenever the LLM settings change, plus the
  // session JWT. All go through one effect so a fresh client never loses its
  // credentials or auth token.
  useEffect(() => {
    const client =
      settings.engineUrlOverride === ""
        ? new EngineClient()
        : new EngineClient(settings.engineUrlOverride);
    client.setCredentials(
      settings.llmApiKey.trim() === ""
        ? null
        : {
            provider: settings.llmProvider,
            model: settings.llmModel,
            apiKey: settings.llmApiKey,
          },
    );
    if (engineJwt !== "") client.setToken(engineJwt);
    clientRef.current = client;
  }, [
    settings.engineUrlOverride,
    settings.llmProvider,
    settings.llmModel,
    settings.llmApiKey,
    engineJwt,
  ]);

  // Global shortcuts. Modifier combos fire anywhere; bare keys (m, ?) are
  // suppressed while typing in an input / textarea / CodeMirror so they don't
  // hijack editing.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        setIsAskOpen((open) => !open);
        return;
      }
      if (event.altKey && (event.key === "a" || event.key === "A")) {
        event.preventDefault();
        setIsSidebarCollapsed((collapsed) => !collapsed);
        return;
      }
      if (event.key === "Escape") {
        setIsSidebarCollapsed((collapsed) => (collapsed ? collapsed : true));
        setIsShortcutsOpen((open) => (open ? false : open));
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setIsShortcutsOpen((open) => !open);
        return;
      }
      if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        setShowMinimap((on) => !on);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [setIsSidebarCollapsed, setShowMinimap]);

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  // Selection state lives in useCanvasSelectionSync, which must run after
  // useWorkspaceFiles (it needs openFiles / switchToFile) — the callbacks
  // below reach it through a stable ref assigned once the hook has returned.
  const selectionRef = useRef<CanvasSelectionSync | null>(null);

  // Reset the ephemeral run / edit UI to a clean slate. Used whenever the
  // active document changes (open a file, switch files, apply a draft).
  const resetTransient = useCallback((): void => {
    selectionRef.current?.reset();
    setPatches([]);
    setEvents([]);
    setRuntimeByNode({});
    setTimingByNode({});
    setRowsByNode({});
    setRunSummary(null);
    setStreamingCellIndex(null);
    setStreamingNotebookPath(null);
    setExplanation(null);
    setSaveStatus("idle");
  }, []);

  const handleNotebookCreated = useCallback((): void => {
    selectionRef.current?.setFocusedCellIndex(0);
  }, []);

  // Detach the cloud linkage when the workspace is replaced wholesale. The
  // cloud state lives in useCloudNotebooks, which must run after
  // useWorkspaceFiles (it needs collectWorkspaceDocument) — bridge the cycle
  // with a stable ref that is (re)assigned once the cloud hook has returned.
  const detachCloudRef = useRef<() => void>(() => {});
  const handleWorkspaceReplaced = useCallback((): void => {
    detachCloudRef.current();
  }, []);

  // Multi-file workspace core: the active notebook, open-file rail, frozen
  // snapshots, per-cell outputs, canvas group positions, and file operations.
  const {
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
  } = useWorkspaceFiles({
    onDocumentChange: resetTransient,
    onNotebookCreated: handleNotebookCreated,
    applyUi: applyWorkspaceUi,
    onError: setError,
    onWorkspaceReplaced: handleWorkspaceReplaced,
    t,
  });

  // Canvas <-> notebook selection sync: the selected node, focused cell, and
  // scroll-to-cell navigation target.
  const handleRevealCells = useCallback((): void => {
    setIsCellsCollapsed(false);
  }, [setIsCellsCollapsed]);
  const selection = useCanvasSelectionSync({
    graph,
    activeName: notebook.name,
    openFiles,
    switchToFile,
    onRevealCells: handleRevealCells,
  });
  const {
    selected,
    setSelected,
    focusedCellIndex,
    setFocusedCellIndex,
    cellNavigationTarget,
    handleFocusCell,
    handleNodeSelect,
  } = selection;
  // Direct ref assignment during render keeps timing identical — the ref is
  // only read from event handlers.
  selectionRef.current = selection;

  // Selecting a node should surface its inspector in the right sidebar.
  useEffect(() => {
    if (selected !== null) {
      setIsSidebarCollapsed(false);
    }
  }, [selected, setIsSidebarCollapsed]);

  // Construct the SyncEngine for the workspace. Re-created when the set of open
  // files changes so closed notebooks drop out of the union graph; the ingest
  // effect below repopulates it with every open file.
  // biome-ignore lint/correctness/useExhaustiveDependencies: openFilesKey is the intended reset trigger, not read in the body
  useEffect(() => {
    const engine = new SyncEngine({
      onGraphUpdate: setGraph,
      onCellPatch: (patch: CellPatch): Promise<void> => {
        setPatches((prev) => [...prev, patch]);
        const target = resolveWorkspacePatchTarget(
          workspacePatchLookupRef.current,
          patch.notebookPath,
        );
        if (target.kind === "active") {
          setNotebook((prev) => applyCellPatch(prev, patch));
        } else if (target.kind === "snapshot") {
          snapshotsRef.current.set(
            target.fileId,
            applyPatchToSnapshot(target.snapshot, target.name, patch),
          );
          setWorkspaceRevision((revision) => revision + 1);
        }
        return Promise.resolve();
      },
    });
    engineRef.current = engine;
  }, [openFilesKey]);

  // Ingest open files so the canvas is the union pipeline across files;
  // cross-notebook (alias:Node.port) refs resolve between groups. Each ingest
  // already recomputes all wires workspace-wide, so re-ingesting files whose
  // cells didn't change is pure redundancy — skip them by comparing the
  // per-path cells array identity against what we last ingested (the
  // cellsByPath memo preserves entry identity for untouched files). A fresh
  // SyncEngine (created on open/close via openFilesKey) resets the tracker so
  // every file is ingested into the new engine.
  const ingestedCellsRef = useRef<{
    engine: SyncEngine | null;
    byPath: Map<string, NotebookCell[]>;
  }>({ engine: null, byPath: new Map() });
  useEffect(() => {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    if (ingestedCellsRef.current.engine !== engine) {
      ingestedCellsRef.current = { engine, byPath: new Map() };
    }
    const ingested = ingestedCellsRef.current.byPath;
    for (const file of openFiles) {
      const cells = cellsByPath.get(file.name);
      if (cells !== undefined && ingested.get(file.name) !== cells) {
        ingested.set(file.name, cells);
        void engine.ingestNotebook(file.name, cells, Date.now());
      }
    }
  }, [openFiles, cellsByPath]);

  // Persist Settings dialog state (engine URL override + theme) and apply the
  // theme to the <html> element. "system" tracks prefers-color-scheme.
  useEffect(() => {
    applyTheme(settings.theme);
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // best-effort persistence
    }
  }, [settings]);

  // Uploaded data files (CSVs etc.) a pipeline can read by name. Lives on the
  // engine; the Files panel lists them.
  const [dataFiles, setDataFiles] = useState<DataFile[]>([]);
  const refreshDataFiles = useCallback(async (): Promise<void> => {
    try {
      setDataFiles(await clientRef.current.listDataFiles());
    } catch {
      // Engine offline / older engine without /files -- leave the list empty.
    }
  }, []);
  const triggerUploadData = useCallback((): void => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.tsv,.json,.parquet,.txt,.xlsx";
    input.onchange = (): void => {
      const file = input.files?.[0];
      if (file === undefined) {
        return;
      }
      void clientRef.current
        .uploadDataFile(file)
        .then(() => refreshDataFiles())
        .catch((err: unknown) => {
          setError(formatError(t, err, "app.errors.uploadFailed"));
        });
    };
    input.click();
  }, [refreshDataFiles, t]);
  const handleDeleteData = useCallback(
    (name: string): void => {
      void clientRef.current
        .deleteDataFile(name)
        .then(() => refreshDataFiles())
        .catch((err: unknown) => {
          setError(formatError(t, err, "app.errors.deleteFailed"));
        });
    },
    [refreshDataFiles, t],
  );
  // Load (and reload) the data-file list when the engine target changes
  // (the client is rebuilt then, so we refetch from the new engine).
  // biome-ignore lint/correctness/useExhaustiveDependencies: engineUrlOverride is the intended refetch trigger, not read in the body
  useEffect(() => {
    void refreshDataFiles();
  }, [refreshDataFiles, settings.engineUrlOverride]);

  const handleCellsChange = useCallback(
    (next: NotebookCell[]): void => {
      setNotebook((prev) => ({ ...prev, cells: next }));
    },
    [setNotebook],
  );

  const handleAddCell = useCallback(
    (kind: CellKind): void => {
      const fresh: NotebookCell = { cellType: kind, source: "" };
      setNotebook((prev) => {
        const nextCells = [...prev.cells, fresh];
        const nextDocCells = [...prev.doc.cells, toIpynbCell(fresh)];
        setFocusedCellIndex(nextCells.length - 1);
        return { ...prev, cells: nextCells, doc: { ...prev.doc, cells: nextDocCells } };
      });
    },
    [setNotebook, setFocusedCellIndex],
  );

  const handleDeleteFocusedCell = useCallback((): void => {
    if (focusedCellIndex === null) {
      return;
    }
    setNotebook((prev) => {
      if (focusedCellIndex < 0 || focusedCellIndex >= prev.cells.length) {
        return prev;
      }
      const nextCells = prev.cells.slice();
      nextCells.splice(focusedCellIndex, 1);
      const nextDocCells = prev.doc.cells.slice();
      nextDocCells.splice(focusedCellIndex, 1);
      return { ...prev, cells: nextCells, doc: { ...prev.doc, cells: nextDocCells } };
    });
    updateOutputsForFile(activeFileIdRef.current, (current) =>
      shiftOutputsAfterDelete(current, focusedCellIndex),
    );
    setFocusedCellIndex(null);
  }, [
    focusedCellIndex,
    updateOutputsForFile,
    activeFileIdRef.current,
    setNotebook,
    setFocusedCellIndex,
  ]);

  const handleCopyFocusedCell = useCallback((): void => {
    if (focusedCellIndex === null) {
      return;
    }
    const cell = notebook.cells[focusedCellIndex];
    if (cell !== undefined) {
      setCellClipboard({ ...cell });
    }
  }, [focusedCellIndex, notebook.cells]);

  const handleCutFocusedCell = useCallback((): void => {
    handleCopyFocusedCell();
    handleDeleteFocusedCell();
  }, [handleCopyFocusedCell, handleDeleteFocusedCell]);

  const handlePasteCell = useCallback((): void => {
    if (cellClipboard === null) {
      return;
    }
    const insertAt = focusedCellIndex === null ? notebook.cells.length : focusedCellIndex + 1;
    setNotebook((prev) => {
      const nextCells = prev.cells.slice();
      nextCells.splice(insertAt, 0, { ...cellClipboard });
      const nextDocCells = prev.doc.cells.slice();
      nextDocCells.splice(insertAt, 0, toIpynbCell(cellClipboard));
      return { ...prev, cells: nextCells, doc: { ...prev.doc, cells: nextDocCells } };
    });
    updateOutputsForFile(activeFileIdRef.current, (current) =>
      shiftOutputsAfterInsert(current, insertAt),
    );
    setFocusedCellIndex(insertAt);
  }, [
    cellClipboard,
    focusedCellIndex,
    notebook.cells.length,
    updateOutputsForFile,
    activeFileIdRef.current,
    setNotebook,
    setFocusedCellIndex,
  ]);

  const handleChangeFocusedCellType = useCallback(
    (kind: CellKind): void => {
      if (focusedCellIndex === null) {
        return;
      }
      setNotebook((prev) => {
        const cell = prev.cells[focusedCellIndex];
        if (cell === undefined) {
          return prev;
        }
        const updated: NotebookCell = { ...cell, cellType: kind };
        const nextCells = prev.cells.slice();
        nextCells[focusedCellIndex] = updated;
        const nextDocCells = prev.doc.cells.slice();
        nextDocCells[focusedCellIndex] = toIpynbCell(updated);
        return { ...prev, cells: nextCells, doc: { ...prev.doc, cells: nextDocCells } };
      });
      if (kind !== "code") {
        updateOutputsForFile(activeFileIdRef.current, (current) => {
          if (current[focusedCellIndex] === undefined) {
            return current;
          }
          const next = { ...current };
          delete next[focusedCellIndex];
          return next;
        });
      }
    },
    [focusedCellIndex, updateOutputsForFile, setNotebook, activeFileIdRef.current],
  );

  const handleRename = useCallback((nodeId: string, nextName: string): void => {
    void engineRef.current?.renameNode(nodeId, nextName, Date.now());
  }, []);

  const handleInputsChange = useCallback((nodeId: string, nextInputs: string[]): void => {
    void engineRef.current?.setNodeInputs(nodeId, nextInputs, Date.now());
  }, []);

  const handleOutputsChange = useCallback((nodeId: string, nextOutputs: string[]): void => {
    void engineRef.current?.setNodeOutputs(nodeId, nextOutputs, Date.now());
  }, []);

  // Draw a connection on the canvas → SyncEngine.createWire appends an `in=`
  // ref to the target node's marker. Cross-file wires are recorded alias-
  // qualified (`alias:Node.port`), so same-named nodes in different files
  // stay distinct.
  const handleWireCreate = useCallback((wire: Omit<WireModel, "id">): void => {
    void engineRef.current?.createWire(
      wire.sourceNodeId,
      wire.sourcePort,
      wire.targetNodeId,
      wire.targetPort,
      Date.now(),
    );
  }, []);

  // Delete an edge → drop its ref from the target node's declared inputs.
  const handleWireDelete = useCallback(
    (wireId: string): void => {
      const wire = graph.wires[wireId];
      if (wire === undefined) {
        return;
      }
      const target = graph.nodes[wire.targetNodeId];
      if (target === undefined) {
        return;
      }
      const nextInputs = target.inputs.filter((ref) => ref !== wire.targetPort);
      void engineRef.current?.setNodeInputs(wire.targetNodeId, nextInputs, Date.now());
    },
    [graph],
  );

  const handleAddNode = useCallback(
    (
      manifest: NodeManifestDef,
      options?: { notebookPath?: string; insertAtCellIndex?: number },
    ): void => {
      const engine = engineRef.current;
      if (engine === null) {
        return;
      }
      const targetPath = options?.notebookPath ?? notebook.name;
      const cells = cellsByPath.get(targetPath) ?? [];
      const insertAtCellIndex = options?.insertAtCellIndex ?? cells.length;
      setError(null);
      void addManifestNode(engine, (request) => clientRef.current.synthesizeNode(request), {
        manifest,
        notebookPath: targetPath,
        insertAtCellIndex,
        onSynthesisError: (err: unknown) => {
          const message = formatError(t, err);
          setError(t("app.errors.addNodeNamed", { name: manifest.name, message }));
        },
      }).catch((err: unknown) => {
        const message = formatError(t, err);
        setError(t("app.errors.addNodeNamed", { name: manifest.name, message }));
      });
    },
    [cellsByPath, notebook.name, t],
  );

  // One-click: turn an uploaded data file into an input node that reads it.
  // The output port is a safe identifier derived from the file name, and the
  // cell body assigns that variable so downstream nodes can consume it.
  const handleAddCsvNode = useCallback(
    (fileName: string): void => {
      const engine = engineRef.current;
      if (engine === null) {
        return;
      }
      const stem = fileName.replace(/\.[^.]+$/, "");
      let port = stem.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      if (!/^[a-z]/.test(port)) {
        port = `data_${port}`;
      }
      if (port === "") {
        port = "data";
      }
      const bodySource = `import pandas as pd\n${port} = pd.read_csv(${JSON.stringify(fileName)})\n`;
      setError(null);
      void engine
        .createNode(
          notebook.name,
          { name: `Load ${stem}`, tag: "input", outputs: [port], bodySource },
          Date.now(),
        )
        .catch((err: unknown) => {
          setError(formatError(t, err, "app.errors.addNode"));
        });
    },
    [notebook.name, t],
  );

  // Drag-from-palette drop handler: gap slots insert after the leading cell;
  // empty-canvas drops still append to the active notebook.
  const handlePaneDrop = useCallback(
    (
      manifestId: string,
      target: {
        groupId?: string;
        insertAfterCellIndex?: number;
        position?: { x: number; y: number };
      },
    ): void => {
      const manifest = paletteNodes.find((entry) => entry.id === manifestId);
      if (manifest === undefined) {
        return;
      }
      if (target.groupId !== undefined && target.insertAfterCellIndex !== undefined) {
        handleAddNode(manifest, {
          notebookPath: target.groupId,
          insertAtCellIndex: target.insertAfterCellIndex + 1,
        });
        return;
      }
      handleAddNode(manifest);
    },
    [paletteNodes, handleAddNode],
  );

  // Ask the engine to statically analyze cell sources so port autocomplete can
  // suggest real variable names. Debounced and re-run whenever cells change.
  useEffect(() => {
    let cancelled = false;
    const sources = notebook.cells.map((cell) => cell.source);
    const timer = window.setTimeout(() => {
      void clientRef.current.analyzeCells(sources).then((result) => {
        if (!cancelled) {
          setDefinedByCell(result);
        }
      });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [notebook.cells]);

  useEffect(() => {
    let cancelled = false;
    void clientRef.current
      .listNodes()
      .then((nodes) => {
        if (cancelled) {
          return;
        }
        setPaletteNodes(sortPalette(nodes));
        setPaletteError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        const message = formatError(t, err);
        setPaletteError(t("app.errors.loadRegistry", { message }));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  // Map each node to the variable names defined across its cell(s).
  const variablesByNode = useMemo<Record<string, string[]>>(() => {
    const result: Record<string, string[]> = {};
    for (const node of Object.values(graph.nodes)) {
      const names = new Set<string>();
      for (const cellIndex of node.cellIndices) {
        for (const name of definedByCell[cellIndex] ?? []) {
          names.add(name);
        }
      }
      result[node.id] = [...names];
    }
    return result;
  }, [graph, definedByCell]);

  // Canvas meta line: a static input filename parsed from the node's first
  // cell source, merged with the post-run row count from rowsByNode. Either
  // half may be absent; a node with neither gets no entry.
  const metaByNode = useMemo<Record<string, { filename?: string; rows?: number }>>(() => {
    const result: Record<string, { filename?: string; rows?: number }> = {};
    for (const node of Object.values(graph.nodes)) {
      const cellIndex = node.cellIndices[0];
      const source = cellIndex === undefined ? undefined : notebook.cells[cellIndex]?.source;
      const filename = source === undefined ? null : extractSourceFilename(source);
      const rows = rowsByNode[node.id];
      if (filename === null && rows === undefined) {
        continue;
      }
      const entry: { filename?: string; rows?: number } = {};
      if (filename !== null) {
        entry.filename = filename;
      }
      if (rows !== undefined) {
        entry.rows = rows;
      }
      result[node.id] = entry;
    }
    return result;
  }, [graph, notebook.cells, rowsByNode]);

  const pipelineDef = useMemo<PipelineDef>(
    () => buildPipelineDef(graph, cellsByPath),
    [graph, cellsByPath],
  );

  // Input refs that don't resolve to a wire — typically a cross-notebook
  // `alias:Node.port` pointing at a missing alias/node. Surfaced on the canvas.
  const unresolvedByNode = useMemo<Record<string, string[]>>(() => {
    const resolvedByTarget = new Map<string, Set<string>>();
    for (const wire of Object.values(graph.wires)) {
      let set = resolvedByTarget.get(wire.targetNodeId);
      if (set === undefined) {
        set = new Set();
        resolvedByTarget.set(wire.targetNodeId, set);
      }
      set.add(wire.targetPort);
    }
    const result: Record<string, string[]> = {};
    for (const node of Object.values(graph.nodes)) {
      const resolved = resolvedByTarget.get(node.id) ?? new Set<string>();
      const unresolved = node.inputs.filter((ref) => !resolved.has(ref));
      if (unresolved.length > 0) {
        result[node.id] = unresolved;
      }
    }
    return result;
  }, [graph]);

  // Ask the engine for a prose walkthrough of the current pipeline. Backed by
  // Anthropic when configured server-side; falls back to a template outline.
  const handleExplain = useCallback(async (): Promise<void> => {
    if (isExplaining) {
      return;
    }
    setIsExplaining(true);
    setError(null);
    try {
      const result = await clientRef.current.explainPipeline(pipelineDef);
      setExplanation(result);
    } catch (err: unknown) {
      const message = formatError(t, err);
      setError(t("app.errors.explainPipeline", { message }));
    } finally {
      setIsExplaining(false);
    }
  }, [isExplaining, pipelineDef, t]);

  const handleCompose = useCallback(async (): Promise<void> => {
    if (composePrompt.trim() === "") {
      setComposeError(t("app.errors.composeEmpty"));
      return;
    }
    setIsComposing(true);
    setComposeError(null);
    try {
      const result = await clientRef.current.proposePipeline(composePrompt.trim());
      setComposeResult(result);
    } catch (err: unknown) {
      const message = formatError(t, err);
      setComposeError(t("app.errors.composePipeline", { message }));
    } finally {
      setIsComposing(false);
    }
  }, [composePrompt, t]);

  const refreshTriggers = useCallback(async (): Promise<void> => {
    setIsLoadingTriggers(true);
    setTriggersError(null);
    try {
      const list = await clientRef.current.listTriggers();
      setTriggers(list);
    } catch (err: unknown) {
      const message = formatError(t, err);
      setTriggersError(t("app.errors.loadTriggers", { message }));
    } finally {
      setIsLoadingTriggers(false);
    }
  }, [t]);

  useEffect(() => {
    if (!isTriggersOpen) {
      return;
    }
    void refreshTriggers();
  }, [isTriggersOpen, refreshTriggers]);

  const handleAsk = useCallback(async (): Promise<void> => {
    if (askPrompt.trim() === "") {
      setAskError(t("app.errors.askEmpty"));
      return;
    }
    setIsAsking(true);
    setAskError(null);
    try {
      // Pass the current pipeline as context so the answer can reference
      // specific node names. When the canvas is empty we omit it -- the
      // engine treats absent pipelines as a general Q&A.
      const pipeline = pipelineDef.nodes.length > 0 ? pipelineDef : undefined;
      const result = await clientRef.current.askLLM(askPrompt.trim(), pipeline);
      setAskResult(result);
    } catch (err: unknown) {
      const message = formatError(t, err);
      setAskError(t("app.errors.reachEngine", { message }));
    } finally {
      setIsAsking(false);
    }
  }, [askPrompt, pipelineDef, t]);

  const handleApplyProposal = useCallback((): void => {
    if (composeResult === null || composeResult.cellSources.length === 0) {
      return;
    }
    const nextCells: NotebookCell[] = composeResult.cellSources.map((source) => ({
      cellType: "code",
      source,
    }));
    const fileName =
      composeResult.notebookPath !== "" ? composeResult.notebookPath : "drafted.ipynb";
    const nextDoc: IpynbDoc = {
      ...notebook.doc,
      cells: nextCells.map((cell) => toIpynbCell(cell)),
      nbformat: notebook.doc.nbformat ?? 4,
      nbformat_minor: notebook.doc.nbformat_minor ?? 5,
      metadata: notebook.doc.metadata ?? {},
    };
    setNotebook({ name: fileName, cells: nextCells, doc: nextDoc });
    setBaselineSources(nextCells.map((cell) => cell.source));
    setSelected(null);
    setPatches([]);
    setEvents([]);
    replaceActiveOutputsByCell({});
    setRuntimeByNode({});
    setTimingByNode({});
    setRowsByNode({});
    setRunSummary(null);
    setStreamingCellIndex(null);
    setStreamingNotebookPath(null);
    setFocusedCellIndex(null);
    setExplanation(null);
    fileHandleRef.current = null;
    setSaveStatus("idle");
    setIsComposeOpen(false);
    setComposeResult(null);
    setComposePrompt("");
    setComposeError(null);
  }, [
    composeResult,
    notebook.doc,
    replaceActiveOutputsByCell,
    setBaselineSources,
    setNotebook,
    fileHandleRef,
    setSelected,
    setFocusedCellIndex,
  ]);

  const manifestById = useMemo(
    () => new Map(paletteNodes.map((manifest) => [manifest.id, manifest] as const)),
    [paletteNodes],
  );

  const filteredPaletteNodes = useMemo(() => {
    const query = paletteSearch.trim().toLowerCase();
    return paletteNodes.filter((manifest) => {
      if (paletteTagFilter.size > 0 && !paletteTagFilter.has(manifest.tag)) {
        return false;
      }
      if (query === "") {
        return true;
      }
      return (
        manifest.name.toLowerCase().includes(query) ||
        manifest.id.toLowerCase().includes(query) ||
        manifest.description.toLowerCase().includes(query)
      );
    });
  }, [paletteNodes, paletteSearch, paletteTagFilter]);

  const togglePaletteTag = useCallback((tag: NodeManifestDef["tag"]) => {
    setPaletteTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }, []);

  const clearPaletteFilters = useCallback(() => {
    setPaletteTagFilter(new Set());
    setPaletteSearch("");
  }, []);

  const selectedManifest = useMemo(() => {
    const manifestId = readNotebookflowMetadata(selected?.metadata).manifestId;
    return manifestId === undefined ? null : (manifestById.get(manifestId) ?? null);
  }, [manifestById, selected?.metadata]);

  const selectedAppliedConfig = useMemo(() => {
    if (selected === null || selectedManifest === null) {
      return {};
    }
    return resolveNodeConfig(selectedManifest, selected.metadata);
  }, [selected, selectedManifest]);

  const isConfigDirty =
    selected !== null &&
    selectedManifest !== null &&
    !configValuesEqual(configDraft, selectedAppliedConfig);

  const isConfigBlocked =
    selectedManifest === null ||
    hasMissingRequiredConfig(selectedManifest, configDraft) ||
    !isConfigDirty;

  useEffect(() => {
    if (
      selected === null ||
      selectedManifest === null ||
      selectedManifest.configFields.length === 0
    ) {
      setConfigDraft({});
      setConfigError(null);
      setConfigWarnings([]);
      setConfigStatus(null);
      return;
    }
    setConfigDraft(resolveNodeConfig(selectedManifest, selected.metadata));
    setConfigError(null);
    setConfigWarnings([]);
    setConfigStatus(buildGenerationStatus(readNotebookflowMetadata(selected.metadata)));
  }, [selected?.id, selectedManifest, selected?.metadata, selected]);

  const handleApplySelectedConfig = useCallback((): void => {
    const engine = engineRef.current;
    if (engine === null || selected === null || selectedManifest === null) {
      return;
    }

    const nextConfig = sanitizeConfigForManifest(selectedManifest, configDraft);
    const currentSource = stripMarkerLine(
      notebook.cells[selected.cellIndices[0] ?? 0]?.source ?? "",
    );
    setConfigError(null);
    setConfigWarnings([]);
    setIsConfigSubmitting(true);

    void clientRef.current
      .synthesizeNode({
        manifestId: selectedManifest.id,
        nodeName: selected.name,
        inputs: selected.inputs,
        outputs: selected.outputs,
        config: nextConfig,
        currentSource,
      })
      .then(async (result) => {
        const metadata = writeNotebookflowMetadata(selected.metadata, {
          manifestId: selectedManifest.id,
          manifestVersion: selectedManifest.version,
          config: nextConfig,
          lastGeneratedAt: new Date().toISOString(),
          lastGenerationBackend: result.backend,
        });
        await engine.updateNodeContents(
          selected.id,
          { bodySource: result.source, metadata },
          Date.now(),
        );
        setConfigDraft(nextConfig);
        setConfigWarnings(result.warnings);
        setConfigStatus(buildGenerationStatus(readNotebookflowMetadata(metadata)));
      })
      .catch((err: unknown) => {
        const message = formatError(t, err);
        setConfigError(t("app.errors.updateNode", { name: selected.name, message }));
      })
      .finally(() => {
        setIsConfigSubmitting(false);
      });
  }, [configDraft, notebook.cells, selected, selectedManifest, t]);

  const handleRun = useCallback((): void => {
    if (isRunning) {
      return;
    }
    setEvents([]);
    clearOutputsForOpenFiles();
    setTimingByNode({});
    setRowsByNode({});
    setRunSummary(null);
    setStreamingCellIndex(null);
    setStreamingNotebookPath(null);
    const initialRuntime: Record<string, RuntimeState> = {};
    for (const nodeId of Object.keys(graph.nodes)) {
      initialRuntime[nodeId] = "queued";
    }
    setRuntimeByNode(initialRuntime);
    setIsRunning(true);
    setError(null);
    clientRef.current
      .runPipeline({
        pipelineId: `web-${String(Date.now())}`,
        pipeline: pipelineDef,
        onEvent: (event) => {
          setEvents((prev) => [...prev, event]);
          if (event.type === "nodeStarted") {
            setRuntimeByNode((prev) => ({ ...prev, [event.nodeId]: "running" }));
            const node = graph.nodes[event.nodeId];
            const cellIndex = node?.cellIndices[0];
            setStreamingCellIndex(cellIndex ?? null);
            setStreamingNotebookPath(node?.groupId ?? null);
            // Reset this cell's outputs so the streaming cursor doesn't ride
            // on top of stale text from a prior run.
            if (node !== undefined && cellIndex !== undefined) {
              updateOutputsForNotebookPath(node.groupId, (prev) => {
                if (prev[cellIndex] === undefined) {
                  return prev;
                }
                const next = { ...prev };
                delete next[cellIndex];
                return next;
              });
            }
          }
          if (event.type === "nodeCompleted") {
            const node = graph.nodes[event.result.nodeId];
            const cellIndex = node?.cellIndices[0];
            if (node !== undefined && cellIndex !== undefined) {
              updateOutputsForNotebookPath(node.groupId, (prev) => ({
                ...prev,
                [cellIndex]: event.result.outputs,
              }));
              setStreamingCellIndex((current) => (current === cellIndex ? null : current));
              setStreamingNotebookPath((current) => (current === node.groupId ? null : current));
            }
            const status = event.result.status;
            if (status === "ok" || status === "error" || status === "skipped") {
              setRuntimeByNode((prev) => ({ ...prev, [event.result.nodeId]: status }));
            }
            setTimingByNode((prev) => ({
              ...prev,
              [event.result.nodeId]: event.result.durationMs,
            }));
            const rows = event.result.metadata?.rows;
            if (rows !== undefined) {
              setRowsByNode((prev) => ({ ...prev, [event.result.nodeId]: rows }));
            }
          }
          if (event.type === "pipelineCompleted") {
            const summary: RunSummary = {
              totalNodes: event.results.length,
              ok: event.results.filter((r) => r.status === "ok").length,
              error: event.results.filter((r) => r.status === "error").length,
              skipped: event.results.filter((r) => r.status === "skipped").length,
              totalDurationMs: event.results.reduce((sum, r) => sum + r.durationMs, 0),
            };
            setRunSummary(summary);
          }
        },
      })
      .catch((err: unknown) => {
        const message = formatError(t, err);
        setError(t("app.errors.runFailed", { message }));
      })
      .finally(() => {
        setIsRunning(false);
        setStreamingCellIndex(null);
        setStreamingNotebookPath(null);
      });
  }, [isRunning, clearOutputsForOpenFiles, pipelineDef, graph, updateOutputsForNotebookPath, t]);

  // Workspace export: collect the full workspace document and the two
  // download handlers. The cloud save below reuses collectWorkspaceDocument.
  const { collectWorkspaceDocument, handleDownloadAll, handleDownloadWorkspace } =
    useWorkspaceExport({
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
    });

  // --- Cloud notebooks (#60): save/open/delete the user's workspaces in Turso.
  const {
    isCloudOpen,
    setIsCloudOpen,
    cloudList,
    cloudId,
    cloudBusy,
    cloudError,
    refreshCloudList,
    handleSaveToCloud,
    handleOpenFromCloud,
    handleDeleteFromCloud,
    detach: detachCloud,
  } = useCloudNotebooks({
    collectWorkspaceDocument,
    applyWorkspaceDocument,
    activeName: notebook.name,
    t,
  });
  // Direct ref assignment during render keeps timing identical — the callback
  // is only ever invoked from event handlers.
  detachCloudRef.current = detachCloud;

  // Load the account's encrypted provider key on sign-in (#61). On a fresh
  // device (no local key) it populates Settings; otherwise it just marks
  // "saved" so a locally-entered key isn't clobbered.
  useEffect(() => {
    if (!session.data) {
      setAccountKeyState("none");
      return;
    }
    let cancelled = false;
    getProviderKey()
      .then((key) => {
        if (cancelled || key === null) return;
        setAccountKeyState("saved");
        setSettings((prev) =>
          prev.llmApiKey.trim() === ""
            ? {
                ...prev,
                llmProvider: key.provider || prev.llmProvider,
                llmModel: key.model,
                llmApiKey: key.apiKey,
              }
            : prev,
        );
      })
      .catch(() => {
        /* signed out / offline */
      });
    return () => {
      cancelled = true;
    };
  }, [session.data]);

  const handleSaveKeyToAccount = useCallback(async (): Promise<void> => {
    setAccountKeyState("saving");
    try {
      await saveProviderKey({
        provider: settings.llmProvider,
        model: settings.llmModel,
        apiKey: settings.llmApiKey,
      });
      setAccountKeyState("saved");
    } catch {
      setAccountKeyState("none");
    }
  }, [settings.llmProvider, settings.llmModel, settings.llmApiKey]);

  const handleRemoveKeyFromAccount = useCallback(async (): Promise<void> => {
    try {
      await deleteProviderKey();
    } finally {
      setAccountKeyState("none");
    }
  }, []);

  const handleExportAccountData = useCallback(async (): Promise<void> => {
    await downloadAccountData(clientRef.current);
  }, []);

  const handleDeleteAccount = useCallback(async (): Promise<void> => {
    // Purge the engine while the current JWT is still valid. Only after that
    // succeeds do we remove the auth/database account and revoke its sessions.
    await clientRef.current.deleteAccountData();
    await deleteRemoteAccount();
    setDataFiles([]);
    setAccountKeyState("none");
    setSettings((current) => ({ ...current, llmApiKey: "" }));
    window.location.assign("/");
  }, []);

  const handleSave = useCallback(async (): Promise<void> => {
    setSaveStatus("saving");
    try {
      let handle = fileHandleRef.current;
      if (handle === null) {
        const suggestedName = notebook.name.endsWith(".ipynb")
          ? notebook.name
          : `${notebook.name}.ipynb`;
        const picked = await pickSaveFileHandle({
          suggestedName,
          types: [
            {
              description: t("app.save.pickerDescription"),
              accept: { "application/x-ipynb+json": [".ipynb"] },
            },
          ],
        });
        if (picked === null) {
          setSaveStatus("idle");
          return;
        }
        handle = picked;
        fileHandleRef.current = picked;
      }
      const json = serializeNotebook(notebook.cells, notebook.doc, outputsByCell);
      await writeFileHandle(handle, json);
      setBaselineSources(notebook.cells.map((cell) => cell.source));
      setSaveStatus("saved");
      window.setTimeout(() => {
        setSaveStatus("idle");
      }, 1500);
    } catch (err: unknown) {
      setSaveStatus("idle");
      // User-cancelled picker raises AbortError -- treat as a no-op, not an error.
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      const message = formatError(t, err);
      setError(t("app.errors.saveFailed", { message }));
    }
  }, [notebook, outputsByCell, t, setBaselineSources, fileHandleRef.current, fileHandleRef]);

  const handleReingest = useCallback((): void => {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    setPatches([]);
    void engine.ingestNotebook(notebook.name, notebook.cells, Date.now());
  }, [notebook]);

  return (
    <FileDropZone onFile={handleFile}>
      <div className="flex h-screen overflow-hidden flex-col bg-background text-foreground font-sans">
        <AppHeader
          engineClient={clientRef.current}
          saveStatus={saveStatus}
          hasSaveTarget={fileHandleRef.current !== null}
          onSave={() => {
            void handleSave();
          }}
          isSignedIn={Boolean(session.data)}
          onOpenCloud={() => {
            setIsCloudOpen(true);
            void refreshCloudList();
          }}
          triggersCount={triggers.length}
          onOpenTriggers={() => {
            setIsTriggersOpen(true);
          }}
          isExplaining={isExplaining}
          onExplain={() => {
            void handleExplain();
          }}
          onOpenCompose={() => {
            setIsComposeOpen(true);
          }}
          onOpenAsk={() => {
            setIsAskOpen(true);
          }}
          isRunning={isRunning}
          onRun={handleRun}
          onToggleShortcuts={() => {
            setIsShortcutsOpen((open) => !open);
          }}
          onToggleSettings={() => {
            setIsSettingsOpen((open) => !open);
          }}
          notebookName={notebook.name}
          onDownloadWorkspace={handleDownloadWorkspace}
          onDownloadAll={() => {
            void handleDownloadAll();
          }}
          onReingest={handleReingest}
        />

        {isSettingsOpen && (
          <SettingsDialog
            settings={settings}
            onChange={setSettings}
            onClose={() => {
              setIsSettingsOpen(false);
            }}
            email={session.data?.user.email ?? null}
            onSignOut={() => void authClient.signOut()}
            signedIn={session.data !== null && session.data !== undefined}
            accountKeyState={accountKeyState}
            onSaveKeyToAccount={() => {
              void handleSaveKeyToAccount();
            }}
            onRemoveKeyFromAccount={() => {
              void handleRemoveKeyFromAccount();
            }}
            onExportData={handleExportAccountData}
            onDeleteAccount={handleDeleteAccount}
          />
        )}

        {isShortcutsOpen && (
          <ShortcutsDialog
            onClose={() => {
              setIsShortcutsOpen(false);
            }}
          />
        )}

        {isCloudOpen && (
          <CloudNotebooksDialog
            notebooks={cloudList}
            currentName={notebook.name}
            cloudId={cloudId}
            busy={cloudBusy}
            error={cloudError}
            onSave={() => {
              void handleSaveToCloud();
            }}
            onOpen={(id) => {
              void handleOpenFromCloud(id);
            }}
            onDelete={(id) => {
              void handleDeleteFromCloud(id);
            }}
            onClose={() => {
              setIsCloudOpen(false);
            }}
          />
        )}

        {explanation !== null && (
          <ExplanationPanel
            explanation={explanation}
            labels={explanationLabels}
            onClose={() => {
              setExplanation(null);
            }}
          />
        )}

        {isComposeOpen && (
          <ComposeDialog
            prompt={composePrompt}
            labels={composeLabels}
            isComposing={isComposing}
            result={composeResult}
            errorMessage={composeError}
            onPromptChange={setComposePrompt}
            onSubmit={() => {
              void handleCompose();
            }}
            onApply={handleApplyProposal}
            onClose={() => {
              setIsComposeOpen(false);
              setComposeResult(null);
              setComposeError(null);
            }}
          />
        )}

        {isAskOpen && (
          <AskPalette
            prompt={askPrompt}
            labels={askLabels}
            isAsking={isAsking}
            result={askResult}
            errorMessage={askError}
            onPromptChange={setAskPrompt}
            onSubmit={() => {
              void handleAsk();
            }}
            onClose={() => {
              setIsAskOpen(false);
            }}
          />
        )}

        {isTriggersOpen && (
          <TriggersDialog
            client={clientRef.current}
            triggers={triggers}
            errorMessage={triggersError}
            isLoading={isLoadingTriggers}
            onRefresh={() => {
              void refreshTriggers();
            }}
            onClose={() => {
              setIsTriggersOpen(false);
            }}
          />
        )}

        {error !== null && (
          <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <FilesRail
            files={openFiles}
            activeFileId={activeFileId}
            activeDirty={isDirty}
            collapsed={isFilesCollapsed}
            dataFiles={dataFiles}
            onSelect={switchToFile}
            onClose={closeFile}
            onCreate={handleCreateNotebook}
            onOpen={triggerOpenFile}
            onUploadData={triggerUploadData}
            onDeleteData={handleDeleteData}
            onAddDataNode={handleAddCsvNode}
            onToggleCollapse={() => {
              setIsFilesCollapsed((c) => !c);
            }}
          />
          <div
            ref={contentRef}
            className="grid min-h-0 flex-1 overflow-hidden"
            style={contentStyle}
          >
            <div ref={topPaneRef} className="grid min-h-0 overflow-hidden" style={topPaneStyle}>
              {isCellsCollapsed ? (
                <div className="flex w-full items-start justify-center border-r bg-muted/30 py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 px-0"
                    title={t("app.panels.showCode")}
                    aria-label={t("app.panels.showCode")}
                    onClick={() => {
                      setIsCellsCollapsed(false);
                    }}
                  >
                    <PanelLeftOpen className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <>
                  <section className="flex min-h-0 min-w-0 flex-col">
                    <CellToolbar
                      focusedCellIndex={focusedCellIndex}
                      focusedCell={
                        focusedCellIndex === null
                          ? null
                          : (notebook.cells[focusedCellIndex] ?? null)
                      }
                      hasClipboard={cellClipboard !== null}
                      onAddCell={handleAddCell}
                      onDeleteCell={handleDeleteFocusedCell}
                      onCutCell={handleCutFocusedCell}
                      onCopyCell={handleCopyFocusedCell}
                      onPasteCell={handlePasteCell}
                      onChangeCellType={handleChangeFocusedCellType}
                      isAddMenuOpen={isAddCellMenuOpen}
                      onAddCellMenuOpenChange={setIsAddCellMenuOpen}
                      onCollapse={() => {
                        setIsCellsCollapsed(true);
                      }}
                    />
                    <ScrollArea className="min-h-0 min-w-0 flex-1">
                      <CellList
                        cells={notebook.cells}
                        onCellsChange={handleCellsChange}
                        outputsByCell={outputsByCell}
                        scrollToCellIndex={cellNavigationTarget?.index ?? null}
                        scrollToCellRevision={cellNavigationTarget?.revision ?? 0}
                        focusedCellIndex={focusedCellIndex}
                        onFocusCell={handleFocusCell}
                        streamingCellIndex={
                          streamingNotebookPath === notebook.name ? streamingCellIndex : null
                        }
                      />
                    </ScrollArea>
                    <CellPaneFooter cells={notebook.cells} isDirty={isDirty} />
                  </section>
                  <PaneDivider
                    orientation="vertical"
                    label={t("app.panels.resizeNotebookCanvas")}
                    onPointerDown={handleVerticalDividerPointerDown}
                    onKeyDown={handleVerticalDividerKeyDown}
                  />
                </>
              )}

              <section className="flex min-h-0 min-w-0 flex-col">
                <div
                  ref={canvasPaneRef}
                  className="relative grid min-h-0 flex-1 overflow-hidden bg-background"
                  style={canvasBodyStyle}
                >
                  <div ref={canvasBodyRef} className="relative min-h-0 min-w-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="absolute right-3 top-3 z-10 h-7 w-7 px-0 shadow-sm"
                      onClick={toggleSidebar}
                      title={
                        isSidebarCollapsed
                          ? t("app.panels.showSidebarTitle")
                          : t("app.panels.hideSidebarTitle")
                      }
                      aria-label={
                        isSidebarCollapsed
                          ? t("app.panels.showSidebar")
                          : t("app.panels.hideSidebar")
                      }
                    >
                      {isSidebarCollapsed ? (
                        <PanelRight className="size-3.5" />
                      ) : (
                        <PanelRightClose className="size-3.5" />
                      )}
                    </Button>
                    <div className="absolute right-3 bottom-3 z-10 flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-7 px-0 shadow-sm"
                        onClick={handleCreateNotebook}
                        title={t("files.createNotebookButton")}
                        aria-label={t("files.createNotebookButton")}
                      >
                        <FilePlus className="size-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-7 px-0 shadow-sm"
                        onClick={triggerOpenFile}
                        title={t("files.openNotebookButton")}
                        aria-label={t("files.openNotebookButton")}
                      >
                        <Upload className="size-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-7 px-0 shadow-sm"
                        onClick={() => {
                          setIsInspectorCollapsed((open) => !open);
                        }}
                        title={
                          isInspectorCollapsed
                            ? t("app.panels.expandInspector")
                            : t("app.panels.collapseInspector")
                        }
                        aria-label={
                          isInspectorCollapsed
                            ? t("app.panels.expandInspector")
                            : t("app.panels.collapseInspector")
                        }
                      >
                        {isInspectorCollapsed ? (
                          <PanelBottom className="size-3.5" />
                        ) : (
                          <PanelBottomClose className="size-3.5" />
                        )}
                      </Button>
                    </div>
                    <Canvas
                      graph={graph}
                      selectedNodeId={selected?.id ?? null}
                      activeGroupId={notebook.name}
                      onNodeRename={handleRename}
                      onNodeSelect={handleNodeSelect}
                      groupPositions={canvasGroupPositions}
                      onGroupPositionChange={handleGroupPositionChange}
                      onInputsChange={handleInputsChange}
                      onOutputsChange={handleOutputsChange}
                      onWireCreate={handleWireCreate}
                      onWireDelete={handleWireDelete}
                      variablesByNode={variablesByNode}
                      runtimeByNode={runtimeByNode}
                      timingByNode={timingByNode}
                      metaByNode={metaByNode}
                      unresolvedByNode={unresolvedByNode}
                      runSummary={runSummary}
                      onPaneDrop={handlePaneDrop}
                      showMinimap={showMinimap}
                      onToggleMinimap={() => {
                        setShowMinimap((on) => !on);
                      }}
                      labels={canvasLabels}
                    />
                  </div>
                  {!isSidebarCollapsed && (
                    <>
                      <PaneDivider
                        orientation="vertical"
                        label={t("app.panels.resizeCanvasSidebar")}
                        onPointerDown={handleSidebarDividerPointerDown}
                        onKeyDown={handleSidebarDividerKeyDown}
                      />
                      <CanvasSidebar
                        selected={selected}
                        selectedManifest={selectedManifest}
                        configDraft={configDraft}
                        isConfigDirty={isConfigDirty}
                        isConfigSubmitting={isConfigSubmitting}
                        isConfigBlocked={isConfigBlocked}
                        configError={configError}
                        configWarnings={configWarnings}
                        configStatus={configStatus}
                        onConfigChange={(key, value) => {
                          setConfigDraft((current) => ({ ...current, [key]: value }));
                        }}
                        onApplyConfig={handleApplySelectedConfig}
                        nodes={paletteNodes}
                        filteredNodes={filteredPaletteNodes}
                        error={paletteError}
                        search={paletteSearch}
                        tagFilter={paletteTagFilter}
                        onSearchChange={setPaletteSearch}
                        onToggleTag={togglePaletteTag}
                        onClearFilters={clearPaletteFilters}
                        onPick={(manifest) => {
                          handleAddNode(manifest);
                        }}
                      />
                    </>
                  )}
                </div>
              </section>
            </div>

            {!isInspectorCollapsed && (
              <>
                <PaneDivider
                  orientation="horizontal"
                  label={t("app.panels.resizeEditorInspector")}
                  onPointerDown={handleHorizontalDividerPointerDown}
                  onKeyDown={handleHorizontalDividerKeyDown}
                />
                <aside className="flex min-h-0 flex-col bg-muted/30 text-xs">
                  <div
                    className={cn(
                      "grid min-h-0 flex-1 divide-x",
                      DEV_MODE ? "grid-cols-2" : "grid-cols-1",
                    )}
                  >
                    <InspectorPanel
                      title={t("app.panels.executionEvents")}
                      count={events.length}
                      empty={t("app.panels.executionEventsEmpty")}
                    >
                      <ul className="flex flex-col gap-1">
                        {events.map((event, idx) => (
                          <li
                            key={`${event.type}-${String(idx)}`}
                            className="rounded border bg-background px-2 py-1 font-mono text-[11px]"
                          >
                            {renderEvent(event)}
                          </li>
                        ))}
                      </ul>
                    </InspectorPanel>

                    {DEV_MODE && (
                      <InspectorPanel
                        title={t("app.panels.cellPatches")}
                        count={patches.length}
                        empty={t("app.panels.cellPatchesEmpty")}
                      >
                        {patches.map((patch, idx) => (
                          <div
                            key={`${patch.notebookPath}-${String(patch.cellIndex)}-${String(idx)}`}
                            className="rounded border bg-background p-2"
                          >
                            <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                              <Badge variant="outline" className="font-mono uppercase">
                                {patch.operation}
                              </Badge>
                              <Badge variant="secondary" className="font-mono">
                                {t("app.panels.cellLabel", { index: patch.cellIndex })}
                              </Badge>
                            </div>
                            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px]">
                              {patch.newSource ?? t("app.panels.deleted")}
                            </pre>
                          </div>
                        ))}
                      </InspectorPanel>
                    )}
                  </div>
                </aside>
              </>
            )}
          </div>
        </div>
      </div>
    </FileDropZone>
  );
}
