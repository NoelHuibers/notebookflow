/**
 * Standalone web app — fully functional NotebookFlow client.
 *
 * - Drop / pick an `.ipynb` to load cells into the editor + canvas.
 * - Edit cells inline (CodeMirror); the SyncEngine re-ingests after
 *   a 300 ms debounce so the canvas reflects marker edits live.
 * - Click Run to dispatch the current graph over WebSocket to the engine
 *   (default `ws://localhost:8765/ws`; production override via
 *   ``VITE_NOTEBOOKFLOW_ENGINE_URL``). Execution events stream in.
 * - Click Download to save the patched `.ipynb` back to disk.
 */

import type {
  CanvasLabels,
  GraphModel,
  NodeManifestDef,
  NodeModel,
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
  Cloud,
  Command,
  Download,
  ExternalLink,
  FilePlus,
  Keyboard,
  MoreHorizontal,
  PanelBottom,
  PanelBottomClose,
  PanelLeftOpen,
  PanelRight,
  PanelRightClose,
  Play,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  Sparkles,
  Upload,
  Wand2,
  Zap,
} from "lucide-react";
import type {
  ReactElement,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AskPalette } from "@/components/AskPalette";
import { CanvasSidebar } from "@/components/CanvasSidebar";
import { CellList } from "@/components/CellList";
import { CellPaneFooter } from "@/components/CellPaneFooter";
import type { CellKind } from "@/components/CellToolbar";
import { CellToolbar } from "@/components/CellToolbar";
import { CloudNotebooksDialog } from "@/components/CloudNotebooksDialog";
import { ComposeDialog } from "@/components/ComposeDialog";
import { EngineStatus } from "@/components/EngineStatus";
import { ExplanationPanel } from "@/components/ExplanationPanel";
import { FileDropZone } from "@/components/FileDropZone";
import { FilesRail } from "@/components/FilesRail";
import { InspectorPanel } from "@/components/InspectorPanel";
import { Wordmark } from "@/components/Logo";
import { PaneDivider } from "@/components/PaneDivider";
import { SettingsDialog } from "@/components/SettingsDialog";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { TriggersDialog } from "@/components/TriggersDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { authClient, useSession } from "@/lib/auth-client";
import { bootstrapBaselineSources, bootstrapFromFixture } from "@/lib/bootstrap";
import { applyCellPatch } from "@/lib/cellPatch";
import type {
  AskAnswer,
  DataFile,
  EngineEvent,
  NbOutput,
  PipelineDef,
  PipelineExplanation,
  PipelineProposal,
  TriggerSpec,
} from "@/lib/EngineClient";
import { EngineClient } from "@/lib/EngineClient";
import { buildGenerationStatus, renderEvent } from "@/lib/events";
import { canSaveInPlace, pickSaveFileHandle, writeFileHandle } from "@/lib/fileSystemAccess";
import { useI18n } from "@/lib/i18n";
import { openInJupyterLab } from "@/lib/jupyter";
import type { IpynbDoc } from "@/lib/notebook";
import {
  extractSourceFilename,
  parseNotebook,
  serializeNotebook,
  toIpynbCell,
} from "@/lib/notebook";
import {
  createNotebook,
  deleteNotebook,
  getNotebook,
  listNotebooks,
  type NotebookSummary,
  parseWorkspace,
  serializeWorkspace,
  updateNotebook,
} from "@/lib/notebooksApi";
import { sortPalette } from "@/lib/palette";
import { PANEL_STORAGE_KEY, readPanelLayout } from "@/lib/panels";
import { buildPipelineDef, stripMarkerLine } from "@/lib/pipeline";
import { deleteProviderKey, getProviderKey, saveProviderKey } from "@/lib/providerKeyApi";
import type { UserSettings } from "@/lib/settings";
import { applyTheme, readUserSettings, SETTINGS_STORAGE_KEY } from "@/lib/settings";
import { clamp, cn, isTypingTarget } from "@/lib/utils";
import {
  applyPatchToSnapshot,
  resolveWorkspacePatchTarget,
  type WorkspacePatchLookup,
} from "@/lib/workspacePatches";
import { downloadWorkspaceZip, type WorkspaceFile } from "@/lib/workspaceZip";
import type { DragState, FileSnapshot, LoadedNotebook, OpenFileMeta } from "@/types/workspace";

const EMPTY_GRAPH: GraphModel = { nodes: {}, groups: {}, wires: {} };
const DIVIDER_SIZE_PX = 10;
// Cell-patches inspector panel is a dev-only debugging view.
const DEV_MODE = import.meta.env.DEV;

const MIN_NOTEBOOK_WIDTH_PX = 280;
const MIN_CANVAS_BODY_WIDTH_PX = 320;
const MIN_SIDEBAR_WIDTH_PX = 240;
const DEFAULT_SIDEBAR_WIDTH_PX = 288;
const MIN_MAIN_HEIGHT_PX = 220;
const MIN_INSPECTOR_HEIGHT_PX = 140;
const DEFAULT_NOTEBOOK_RATIO = 50;
const DEFAULT_MAIN_RATIO = 72;
const KEYBOARD_RESIZE_STEP = 2;
const DEFAULT_JUPYTER_URL = "http://localhost:8888";

const JUPYTER_URL: string = (() => {
  const raw = import.meta.env.VITE_NOTEBOOKFLOW_JUPYTER_URL;
  // Undefined env var -> use default. Explicitly empty string -> opt-out, no button.
  if (raw === undefined) {
    return DEFAULT_JUPYTER_URL;
  }
  return raw.trim();
})();

function makeFileId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `file-${String(Math.floor(performance.now() * 1000))}`;
}

function uniqueUntitledNotebookName(files: OpenFileMeta[]): string {
  const used = new Set(files.map((file) => file.name));
  if (!used.has("Untitled.ipynb")) {
    return "Untitled.ipynb";
  }
  let suffix = 2;
  let candidate = `Untitled ${String(suffix)}.ipynb`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `Untitled ${String(suffix)}.ipynb`;
  }
  return candidate;
}

function createBlankNotebook(name: string): LoadedNotebook {
  const cells: NotebookCell[] = [{ cellType: "code", source: "" }];
  return {
    name,
    cells,
    doc: {
      cells: cells.map((cell) => toIpynbCell(cell)),
      metadata: {
        kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      },
      nbformat: 4,
      nbformat_minor: 5,
    },
  };
}

function findNodeForCellIndex(
  graph: GraphModel,
  groupId: string,
  cellIndex: number,
): NodeModel | null {
  for (const node of Object.values(graph.nodes)) {
    if (node.groupId === groupId && node.cellIndices.includes(cellIndex)) {
      return node;
    }
  }
  return null;
}

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
  const [notebook, setNotebook] = useState<LoadedNotebook>(() => bootstrapFromFixture());
  // Multi-file workspace. The active file's live content is `notebook`; other
  // open files freeze into snapshotsRef until switched back to.
  const initialFileIdRef = useRef<string>(makeFileId());
  const [openFiles, setOpenFiles] = useState<OpenFileMeta[]>(() => [
    { id: initialFileIdRef.current, name: notebook.name },
  ]);
  const [activeFileId, setActiveFileId] = useState<string>(() => initialFileIdRef.current);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  // Files list and code cells collapse independently — close files without
  // closing code, and vice-versa.
  const [isFilesCollapsed, setIsFilesCollapsed] = useState(() => readPanelLayout().filesCollapsed);
  const [isCellsCollapsed, setIsCellsCollapsed] = useState(() => readPanelLayout().cellsCollapsed);
  const snapshotsRef = useRef<Map<string, FileSnapshot>>(new Map());
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
  const [graph, setGraph] = useState<GraphModel>(EMPTY_GRAPH);
  const [selected, setSelected] = useState<NodeModel | null>(null);
  const [patches, setPatches] = useState<CellPatch[]>([]);
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [outputsByCell, setOutputsByCell] = useState<Record<number, NbOutput[]>>({});
  const [runtimeByNode, setRuntimeByNode] = useState<Record<string, RuntimeState>>({});
  // Post-run output row counts, keyed by node id. Merged with the static
  // filename map (derived from cell source) into the canvas meta line.
  const [rowsByNode, setRowsByNode] = useState<Record<string, number>>({});
  const [streamingCellIndex, setStreamingCellIndex] = useState<number | null>(null);
  const [timingByNode, setTimingByNode] = useState<Record<string, number>>({});
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [focusedCellIndex, setFocusedCellIndex] = useState<number | null>(null);
  const [cellNavigationTarget, setCellNavigationTarget] = useState<{
    index: number;
    revision: number;
  } | null>(null);
  const [cellClipboard, setCellClipboard] = useState<NotebookCell | null>(null);
  const [isAddCellMenuOpen, setIsAddCellMenuOpen] = useState(false);
  const [baselineSources, setBaselineSources] = useState<string[]>(() =>
    bootstrapBaselineSources(),
  );
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
  const [notebookRatio, setNotebookRatio] = useState(DEFAULT_NOTEBOOK_RATIO);
  const [mainRatio, setMainRatio] = useState(DEFAULT_MAIN_RATIO);
  // Right sidebar: selected node + node palette (Alt+A or the canvas toggle).
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => readPanelLayout().sidebarCollapsed,
  );
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH_PX);
  const lastOpenSidebarWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH_PX);
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
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [showMinimap, setShowMinimap] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(
    () => readPanelLayout().inspectorCollapsed,
  );
  const [isTriggersOpen, setIsTriggersOpen] = useState(false);
  // Cloud notebooks (#60): the signed-in user's saved workspaces in Turso.
  const [isCloudOpen, setIsCloudOpen] = useState(false);
  const [cloudList, setCloudList] = useState<NotebookSummary[]>([]);
  const [cloudId, setCloudId] = useState<string | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  // Server-side encrypted provider key (#61): "saved" once one exists in the account.
  const [accountKeyState, setAccountKeyState] = useState<"none" | "saved" | "saving">("none");
  const [triggers, setTriggers] = useState<TriggerSpec[]>([]);
  const [triggersError, setTriggersError] = useState<string | null>(null);
  const [isLoadingTriggers, setIsLoadingTriggers] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
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
  }, []);

  // Selecting a node should surface its inspector in the right sidebar.
  useEffect(() => {
    if (selected !== null) {
      setIsSidebarCollapsed(false);
    }
  }, [selected]);
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const contentRef = useRef<HTMLDivElement | null>(null);
  const topPaneRef = useRef<HTMLDivElement | null>(null);
  const canvasPaneRef = useRef<HTMLDivElement | null>(null);
  const canvasBodyRef = useRef<HTMLDivElement | null>(null);

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

  // Ingest every open file so the canvas is the union pipeline across files;
  // cross-notebook (alias:Node.port) refs resolve between groups. Each ingest
  // recomputes all wires, so file order doesn't matter.
  useEffect(() => {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    for (const file of openFiles) {
      const cells = cellsByPath.get(file.name);
      if (cells !== undefined) {
        void engine.ingestNotebook(file.name, cells, Date.now());
      }
    }
  }, [openFiles, cellsByPath]);

  // Keep the Files rail label in sync when the active notebook is renamed
  // (e.g. applying a Compose draft swaps in a new filename).
  useEffect(() => {
    setOpenFiles((prev) =>
      prev.map((f) =>
        f.id === activeFileId && f.name !== notebook.name ? { ...f, name: notebook.name } : f,
      ),
    );
  }, [notebook.name, activeFileId]);

  useEffect(() => {
    setSelected((current) => (current === null ? null : (graph.nodes[current.id] ?? null)));
  }, [graph]);

  const selectedCellIndexForActiveNotebook = useMemo(() => {
    if (selected === null || selected.groupId !== notebook.name) {
      return null;
    }
    return selected.cellIndices[0] ?? null;
  }, [notebook.name, selected]);

  useEffect(() => {
    if (selectedCellIndexForActiveNotebook !== null) {
      setFocusedCellIndex(selectedCellIndexForActiveNotebook);
    }
  }, [selectedCellIndexForActiveNotebook]);

  // Persist panel collapse state so reloads keep the user's layout.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(
        PANEL_STORAGE_KEY,
        JSON.stringify({
          filesCollapsed: isFilesCollapsed,
          cellsCollapsed: isCellsCollapsed,
          inspectorCollapsed: isInspectorCollapsed,
          sidebarCollapsed: isSidebarCollapsed,
        }),
      );
    } catch {
      // Quota / disabled storage -- silently keep working in-memory.
    }
  }, [isFilesCollapsed, isCellsCollapsed, isInspectorCollapsed, isSidebarCollapsed]);

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

  // Reset the ephemeral run / edit UI to a clean slate. Used whenever the
  // active document changes (open a file, switch files, apply a draft).
  const resetTransient = useCallback((): void => {
    setSelected(null);
    setPatches([]);
    setEvents([]);
    setOutputsByCell({});
    setRuntimeByNode({});
    setTimingByNode({});
    setRowsByNode({});
    setRunSummary(null);
    setStreamingCellIndex(null);
    setFocusedCellIndex(null);
    setCellNavigationTarget(null);
    setExplanation(null);
    setSaveStatus("idle");
  }, []);

  // Freeze the active file's working state so it can be restored when the
  // user switches back to it.
  const snapshotActive = useCallback((): void => {
    snapshotsRef.current.set(activeFileId, {
      cells: notebook.cells,
      doc: notebook.doc,
      baseline: baselineSources,
      fileHandle: fileHandleRef.current,
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
        snapshotsRef.current.delete(targetId);
      }
      resetTransient();
      setActiveFileId(targetId);
    },
    [activeFileId, openFiles, snapshotActive, resetTransient],
  );

  const handleFile = useCallback(
    (text: string, name: string): void => {
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
        resetTransient();
        setError(null);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t("app.errors.unknown");
        setError(t("app.errors.loadFailed", { name, message }));
      }
    },
    [openFiles, snapshotActive, switchToFile, resetTransient, t],
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
    resetTransient();
    setFocusedCellIndex(0);
    setError(null);
  }, [openFiles, snapshotActive, resetTransient]);

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
      setOpenFiles((prev) => prev.filter((f) => f.id !== id));
    },
    [openFiles, activeFileId, switchToFile],
  );

  // Open the OS file picker and load the chosen notebook into the workspace.
  const triggerOpenFile = useCallback((): void => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ipynb,application/json";
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
          setError(err instanceof Error ? err.message : t("app.errors.uploadFailed"));
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
          setError(err instanceof Error ? err.message : t("app.errors.deleteFailed"));
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

  const handleCellsChange = useCallback((next: NotebookCell[]): void => {
    setNotebook((prev) => ({ ...prev, cells: next }));
  }, []);

  const handleFocusCell = useCallback(
    (index: number): void => {
      setFocusedCellIndex(index);
      setSelected(findNodeForCellIndex(graph, notebook.name, index));
    },
    [graph, notebook.name],
  );

  const handleNodeSelect = useCallback(
    (node: NodeModel | null): void => {
      if (node === null) {
        setSelected(null);
        return;
      }

      const targetFile =
        node.groupId === notebook.name
          ? null
          : openFiles.find((file) => file.name === node.groupId);
      if (targetFile !== null && targetFile !== undefined) {
        switchToFile(targetFile.id);
      }

      setSelected(node);
      const cellIndex = node.cellIndices[0] ?? null;
      const canNavigateToCell = node.groupId === notebook.name || targetFile !== undefined;
      if (cellIndex !== null && canNavigateToCell) {
        setIsCellsCollapsed(false);
        setFocusedCellIndex(cellIndex);
        setCellNavigationTarget((current) => ({
          index: cellIndex,
          revision: (current?.revision ?? 0) + 1,
        }));
      }
    },
    [notebook.name, openFiles, switchToFile],
  );

  const handleAddCell = useCallback((kind: CellKind): void => {
    const fresh: NotebookCell = { cellType: kind, source: "" };
    setNotebook((prev) => {
      const nextCells = [...prev.cells, fresh];
      const nextDocCells = [...prev.doc.cells, toIpynbCell(fresh)];
      setFocusedCellIndex(nextCells.length - 1);
      return { ...prev, cells: nextCells, doc: { ...prev.doc, cells: nextDocCells } };
    });
  }, []);

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
    setFocusedCellIndex(null);
  }, [focusedCellIndex]);

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
    setFocusedCellIndex(insertAt);
  }, [cellClipboard, focusedCellIndex, notebook.cells.length]);

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
    },
    [focusedCellIndex],
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
          const message = err instanceof Error ? err.message : t("app.errors.unknown");
          setError(t("app.errors.addNodeNamed", { name: manifest.name, message }));
        },
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : t("app.errors.unknown");
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
          setError(err instanceof Error ? err.message : t("app.errors.addNode"));
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
        const message = err instanceof Error ? err.message : t("app.errors.unknown");
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
      const message = err instanceof Error ? err.message : t("app.errors.unknown");
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
      const message = err instanceof Error ? err.message : t("app.errors.unknown");
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
      const message = err instanceof Error ? err.message : t("app.errors.unknown");
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
      const message = err instanceof Error ? err.message : t("app.errors.unknown");
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
    setOutputsByCell({});
    setRuntimeByNode({});
    setTimingByNode({});
    setRowsByNode({});
    setRunSummary(null);
    setStreamingCellIndex(null);
    setFocusedCellIndex(null);
    setExplanation(null);
    fileHandleRef.current = null;
    setSaveStatus("idle");
    setIsComposeOpen(false);
    setComposeResult(null);
    setComposePrompt("");
    setComposeError(null);
  }, [composeResult, notebook.doc]);

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
        const message = err instanceof Error ? err.message : t("app.errors.unknown");
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
    setOutputsByCell({});
    setTimingByNode({});
    setRowsByNode({});
    setRunSummary(null);
    setStreamingCellIndex(null);
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
            // Reset this cell's outputs so the streaming cursor doesn't ride
            // on top of stale text from a prior run.
            if (cellIndex !== undefined) {
              setOutputsByCell((prev) => {
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
            if (cellIndex !== undefined) {
              setOutputsByCell((prev) => ({ ...prev, [cellIndex]: event.result.outputs }));
              setStreamingCellIndex((current) => (current === cellIndex ? null : current));
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
        const message = err instanceof Error ? err.message : t("app.errors.unknown");
        setError(t("app.errors.runFailed", { message }));
      })
      .finally(() => {
        setIsRunning(false);
        setStreamingCellIndex(null);
      });
  }, [isRunning, pipelineDef, graph, t]);

  // Export every open file's .ipynb as one zip — a single "Download" is
  // ambiguous once the workspace spans multiple files. The active file carries
  // its live cells + run outputs; inactive files come from their snapshots.
  // Serialize every open file's .ipynb — shared by zip export and cloud save.
  const collectWorkspaceFiles = useCallback((): WorkspaceFile[] => {
    return openFiles.map((file) => {
      if (file.id === activeFileId) {
        return {
          name: notebook.name,
          json: serializeNotebook(notebook.cells, notebook.doc, outputsByCell),
        };
      }
      const snap = snapshotsRef.current.get(file.id);
      return {
        name: file.name,
        json: serializeNotebook(snap?.cells ?? [], snap?.doc ?? notebook.doc, {}),
      };
    });
  }, [openFiles, activeFileId, notebook, outputsByCell]);

  const handleDownloadAll = useCallback(async (): Promise<void> => {
    await downloadWorkspaceZip(collectWorkspaceFiles());
    setBaselineSources(notebook.cells.map((cell) => cell.source));
  }, [collectWorkspaceFiles, notebook.cells]);

  // --- Cloud notebooks (#60): save/open/delete the user's workspaces in Turso.
  const refreshCloudList = useCallback(async (): Promise<void> => {
    try {
      setCloudList(await listNotebooks());
    } catch {
      // signed out / offline — leave the list as-is.
    }
  }, []);

  const handleSaveToCloud = useCallback(async (): Promise<void> => {
    setCloudBusy(true);
    setCloudError(null);
    try {
      const content = serializeWorkspace(collectWorkspaceFiles());
      if (cloudId !== null) {
        await updateNotebook(cloudId, { name: notebook.name, content });
      } else {
        setCloudId((await createNotebook(notebook.name, content)).id);
      }
      await refreshCloudList();
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : t("app.errors.cloudSaveFailed"));
    } finally {
      setCloudBusy(false);
    }
  }, [collectWorkspaceFiles, cloudId, notebook.name, refreshCloudList, t]);

  const handleOpenFromCloud = useCallback(
    async (id: string): Promise<void> => {
      setCloudBusy(true);
      setCloudError(null);
      try {
        const record = await getNotebook(id);
        const parsed = parseWorkspace(record.content).map((f) => ({
          id: makeFileId(),
          name: f.name,
          ...parseNotebook(f.json),
        }));
        const first = parsed[0];
        if (first === undefined) {
          setCloudError(t("app.errors.cloudEmpty"));
          return;
        }
        snapshotsRef.current.clear();
        for (const p of parsed.slice(1)) {
          snapshotsRef.current.set(p.id, {
            cells: p.cells,
            doc: p.doc,
            baseline: p.cells.map((c) => c.source),
            fileHandle: null,
          });
        }
        setOpenFiles(parsed.map((p) => ({ id: p.id, name: p.name })));
        setActiveFileId(first.id);
        setNotebook({ name: first.name, cells: first.cells, doc: first.doc });
        setBaselineSources(first.cells.map((c) => c.source));
        fileHandleRef.current = null;
        resetTransient();
        setCloudId(id);
        setIsCloudOpen(false);
      } catch (err) {
        setCloudError(err instanceof Error ? err.message : t("app.errors.cloudOpenFailed"));
      } finally {
        setCloudBusy(false);
      }
    },
    [resetTransient, t],
  );

  const handleDeleteFromCloud = useCallback(
    async (id: string): Promise<void> => {
      setCloudBusy(true);
      setCloudError(null);
      try {
        await deleteNotebook(id);
        if (cloudId === id) setCloudId(null);
        await refreshCloudList();
      } catch (err) {
        setCloudError(err instanceof Error ? err.message : t("app.errors.cloudDeleteFailed"));
      } finally {
        setCloudBusy(false);
      }
    },
    [cloudId, refreshCloudList, t],
  );

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
      const message = err instanceof Error ? err.message : t("app.errors.unknown");
      setError(t("app.errors.saveFailed", { message }));
    }
  }, [notebook, outputsByCell, t]);

  const handleReingest = useCallback((): void => {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    setPatches([]);
    void engine.ingestNotebook(notebook.name, notebook.cells, Date.now());
  }, [notebook]);

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
  const clampNotebookRatio = useCallback((value: number): number => {
    const host = topPaneRef.current;
    if (host === null) {
      return clamp(value, 0, 100);
    }
    const availableWidth = Math.max(host.clientWidth - DIVIDER_SIZE_PX, 1);
    const minRatio = Math.min((MIN_NOTEBOOK_WIDTH_PX / availableWidth) * 100, 50);
    const maxRatio = Math.max(100 - (MIN_CANVAS_BODY_WIDTH_PX / availableWidth) * 100, 50);
    return clamp(value, minRatio, maxRatio);
  }, []);

  const clampMainRatio = useCallback((value: number): number => {
    const host = contentRef.current;
    if (host === null) {
      return clamp(value, 0, 100);
    }
    const availableHeight = Math.max(host.clientHeight - DIVIDER_SIZE_PX, 1);
    const minRatio = Math.min((MIN_MAIN_HEIGHT_PX / availableHeight) * 100, 50);
    const maxRatio = Math.max(100 - (MIN_INSPECTOR_HEIGHT_PX / availableHeight) * 100, 50);
    return clamp(value, minRatio, maxRatio);
  }, []);

  useEffect(() => {
    if (dragState === null) {
      return;
    }

    const handlePointerMove = (event: PointerEvent): void => {
      if (dragState.axis === "vertical") {
        const host = topPaneRef.current;
        if (host === null) {
          return;
        }
        const availableWidth = Math.max(host.clientWidth - DIVIDER_SIZE_PX, 1);
        const deltaRatio = ((event.clientX - dragState.startCoord) / availableWidth) * 100;
        setNotebookRatio(clampNotebookRatio(dragState.startRatio + deltaRatio));
        return;
      }

      const host = contentRef.current;
      if (host === null) {
        return;
      }
      const availableHeight = Math.max(host.clientHeight - DIVIDER_SIZE_PX, 1);
      const deltaRatio = ((event.clientY - dragState.startCoord) / availableHeight) * 100;
      setMainRatio(clampMainRatio(dragState.startRatio + deltaRatio));
    };

    const handlePointerUp = (): void => {
      setDragState(null);
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = dragState.axis === "vertical" ? "col-resize" : "row-resize";

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [clampMainRatio, clampNotebookRatio, dragState]);

  const handleVerticalDividerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      setDragState({
        axis: "vertical",
        startCoord: event.clientX,
        startRatio: notebookRatio,
      });
    },
    [notebookRatio],
  );

  const handleHorizontalDividerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      setDragState({
        axis: "horizontal",
        startCoord: event.clientY,
        startRatio: mainRatio,
      });
    },
    [mainRatio],
  );

  const handleVerticalDividerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setNotebookRatio((current) => clampNotebookRatio(current - KEYBOARD_RESIZE_STEP));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setNotebookRatio((current) => clampNotebookRatio(current + KEYBOARD_RESIZE_STEP));
      } else if (event.key === "Home") {
        event.preventDefault();
        setNotebookRatio(() => clampNotebookRatio(0));
      } else if (event.key === "End") {
        event.preventDefault();
        setNotebookRatio(() => clampNotebookRatio(100));
      }
    },
    [clampNotebookRatio],
  );

  const handleHorizontalDividerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMainRatio((current) => clampMainRatio(current - KEYBOARD_RESIZE_STEP));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setMainRatio((current) => clampMainRatio(current + KEYBOARD_RESIZE_STEP));
      } else if (event.key === "Home") {
        event.preventDefault();
        setMainRatio(() => clampMainRatio(0));
      } else if (event.key === "End") {
        event.preventDefault();
        setMainRatio(() => clampMainRatio(100));
      }
    },
    [clampMainRatio],
  );

  const [sidebarDragState, setSidebarDragState] = useState<{
    startCoord: number;
    startWidth: number;
  } | null>(null);

  const clampSidebarWidth = useCallback((value: number): number => {
    const host = canvasBodyRef.current ?? canvasPaneRef.current;
    if (host === null) {
      return Math.max(MIN_SIDEBAR_WIDTH_PX, value);
    }
    const maxWidth = Math.max(
      host.clientWidth - MIN_CANVAS_BODY_WIDTH_PX - DIVIDER_SIZE_PX,
      MIN_SIDEBAR_WIDTH_PX,
    );
    return clamp(value, MIN_SIDEBAR_WIDTH_PX, maxWidth);
  }, []);

  const toggleSidebar = useCallback((): void => {
    setIsSidebarCollapsed((collapsed) => {
      if (collapsed) {
        setSidebarWidth(clampSidebarWidth(lastOpenSidebarWidthRef.current));
        return false;
      }
      lastOpenSidebarWidthRef.current = sidebarWidth;
      return true;
    });
  }, [clampSidebarWidth, sidebarWidth]);

  useEffect(() => {
    if (!isSidebarCollapsed) {
      lastOpenSidebarWidthRef.current = sidebarWidth;
    }
  }, [isSidebarCollapsed, sidebarWidth]);

  useEffect(() => {
    if (sidebarDragState === null) {
      return;
    }

    const handlePointerMove = (event: PointerEvent): void => {
      const nextWidth = sidebarDragState.startWidth - (event.clientX - sidebarDragState.startCoord);
      setSidebarWidth(clampSidebarWidth(nextWidth));
    };

    const handlePointerUp = (): void => {
      setSidebarDragState(null);
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [clampSidebarWidth, sidebarDragState]);

  useEffect(() => {
    const handleResize = (): void => {
      if (!isSidebarCollapsed) {
        setSidebarWidth((current) => clampSidebarWidth(current));
      }
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [clampSidebarWidth, isSidebarCollapsed]);

  const handleSidebarDividerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      setSidebarDragState({ startCoord: event.clientX, startWidth: sidebarWidth });
    },
    [sidebarWidth],
  );

  const handleSidebarDividerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setSidebarWidth((current) => clampSidebarWidth(current + KEYBOARD_RESIZE_STEP * 8));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setSidebarWidth((current) => clampSidebarWidth(current - KEYBOARD_RESIZE_STEP * 8));
      }
    },
    [clampSidebarWidth],
  );

  const contentStyle = useMemo(
    () =>
      isInspectorCollapsed
        ? { gridTemplateRows: "minmax(0, 1fr)" }
        : {
            gridTemplateRows: `minmax(${MIN_MAIN_HEIGHT_PX}px, ${mainRatio}%) ${DIVIDER_SIZE_PX}px minmax(${MIN_INSPECTOR_HEIGHT_PX}px, calc(${100 - mainRatio}% - ${DIVIDER_SIZE_PX}px))`,
          },
    [isInspectorCollapsed, mainRatio],
  );

  const topPaneStyle = useMemo(
    () =>
      isCellsCollapsed
        ? // Code collapsed: a slim strip (wide enough for the expand button)
          // plus the canvas.
          { gridTemplateColumns: `2.25rem minmax(${MIN_CANVAS_BODY_WIDTH_PX}px, 1fr)` }
        : {
            gridTemplateColumns: `minmax(${MIN_NOTEBOOK_WIDTH_PX}px, ${notebookRatio}%) ${DIVIDER_SIZE_PX}px minmax(${MIN_CANVAS_BODY_WIDTH_PX}px, calc(${100 - notebookRatio}% - ${DIVIDER_SIZE_PX}px))`,
          },
    [isCellsCollapsed, notebookRatio],
  );

  const canvasBodyStyle = useMemo(
    () =>
      isSidebarCollapsed
        ? { gridTemplateColumns: "minmax(0, 1fr)" }
        : {
            gridTemplateColumns: `minmax(0, 1fr) ${DIVIDER_SIZE_PX}px ${sidebarWidth}px`,
          },
    [isSidebarCollapsed, sidebarWidth],
  );

  return (
    <FileDropZone onFile={handleFile}>
      <div className="flex h-screen overflow-hidden flex-col bg-background text-foreground font-sans">
        <header className="flex items-center gap-3 border-b bg-card px-4 py-2.5">
          <Wordmark />
          <EngineStatus client={clientRef.current} />
          <div className="ml-auto flex items-center gap-2">
            {canSaveInPlace && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void handleSave();
                }}
                disabled={saveStatus === "saving"}
                title={
                  fileHandleRef.current === null
                    ? t("app.toolbar.saveTitleFirst")
                    : t("app.toolbar.saveTitleAgain")
                }
              >
                <Save className="mr-1.5 size-3.5" />
                {saveStatus === "saving"
                  ? t("app.toolbar.saving")
                  : saveStatus === "saved"
                    ? t("app.toolbar.saved")
                    : t("app.toolbar.save")}
              </Button>
            )}
            {session.data && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsCloudOpen(true);
                  void refreshCloudList();
                }}
                title={t("app.toolbar.cloudTitle")}
              >
                <Cloud className="mr-1.5 size-3.5" />
                {t("app.toolbar.cloud")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsTriggersOpen(true);
              }}
              title={t("app.toolbar.triggersTitle")}
            >
              <Zap className="mr-1.5 size-3.5" />
              {t("app.toolbar.triggers")}
              {triggers.length > 0 && (
                <Badge variant="outline" className="ml-2 px-1 font-mono text-[10px]">
                  {triggers.length}
                </Badge>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void handleExplain();
              }}
              disabled={isExplaining}
              title={t("app.toolbar.explainTitle")}
            >
              <Sparkles className="mr-1.5 size-3.5" />
              {isExplaining ? t("app.toolbar.explaining") : t("app.toolbar.explain")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsComposeOpen(true);
              }}
              title={t("app.toolbar.composeTitle")}
            >
              <Wand2 className="mr-1.5 size-3.5" />
              {t("app.toolbar.compose")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsAskOpen(true);
              }}
              title={t("app.toolbar.askAiTitle")}
            >
              <Command className="mr-1.5 size-3.5" />
              {t("app.toolbar.askAi")}
              <Badge variant="outline" className="ml-2 px-1 font-mono text-[10px]">
                ⌘K
              </Badge>
            </Button>
            <Button variant="default" size="sm" onClick={handleRun} disabled={isRunning}>
              <Play className="mr-1.5 size-3.5" />
              {isRunning ? t("app.toolbar.running") : t("app.toolbar.runPipeline")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="px-2"
              title={t("app.toolbar.shortcutsTitle")}
              aria-label={t("app.toolbar.shortcuts")}
              onClick={() => {
                setIsShortcutsOpen((open) => !open);
              }}
            >
              <Keyboard className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="px-2"
              title={t("app.toolbar.settings")}
              aria-label={t("app.toolbar.settings")}
              onClick={() => {
                setIsSettingsOpen((open) => !open);
              }}
            >
              <SettingsIcon className="size-4" />
            </Button>
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
                      void handleDownloadAll();
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
                      handleReingest();
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
                        openInJupyterLab(JUPYTER_URL, notebook.name);
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
          </div>
        </header>

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
            onClose={() => {
              setExplanation(null);
            }}
          />
        )}

        {isComposeOpen && (
          <ComposeDialog
            prompt={composePrompt}
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
                    <ScrollArea className="min-h-0 flex-1">
                      <CellList
                        cells={notebook.cells}
                        onCellsChange={handleCellsChange}
                        outputsByCell={outputsByCell}
                        scrollToCellIndex={cellNavigationTarget?.index ?? null}
                        scrollToCellRevision={cellNavigationTarget?.revision ?? 0}
                        focusedCellIndex={focusedCellIndex}
                        onFocusCell={handleFocusCell}
                        streamingCellIndex={streamingCellIndex}
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
