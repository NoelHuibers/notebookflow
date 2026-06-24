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
  GraphModel,
  NodeManifestDef,
  NodeModel,
  RunSummary,
  RuntimeState,
} from "@notebookflow/graph-canvas";
import {
  Canvas,
  configValuesEqual,
  defaultConfigForManifest,
  hasMissingRequiredConfig,
  NODE_DRAG_MIME,
  NodeConfigEditor,
  readNotebookflowMetadata,
  resolveNodeConfig,
  sanitizeConfigForManifest,
  writeNotebookflowMetadata,
} from "@notebookflow/graph-canvas";
import type { CellPatch, NotebookCell } from "@notebookflow/graph-canvas/sync";
import { SyncEngine } from "@notebookflow/graph-canvas/sync";
import {
  ChevronDown,
  ChevronRight,
  Command,
  Copy,
  Download,
  ExternalLink,
  Files,
  Keyboard,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import type {
  ReactElement,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CellList } from "@/components/CellList";
import type { CellKind } from "@/components/CellToolbar";
import { CellToolbar } from "@/components/CellToolbar";
import { EngineStatus } from "@/components/EngineStatus";
import { FileDropZone } from "@/components/FileDropZone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  AskAnswer,
  EngineEvent,
  NbOutput,
  PipelineDef,
  PipelineExplanation,
  PipelineProposal,
  TriggerFiring,
  TriggerKind,
  TriggerSpec,
} from "@/lib/EngineClient";
import { EngineClient } from "@/lib/EngineClient";
import { canSaveInPlace, pickSaveFileHandle, writeFileHandle } from "@/lib/fileSystemAccess";
import type { IpynbDoc } from "@/lib/notebook";
import {
  downloadNotebook,
  extractSourceFilename,
  parseNotebook,
  serializeNotebook,
  toIpynbCell,
} from "@/lib/notebook";
import { cn } from "@/lib/utils";

import twoNode from "./fixtures/two-node.ipynb.json";

const EMPTY_GRAPH: GraphModel = { nodes: {}, groups: {}, wires: {} };
const DIVIDER_SIZE_PX = 10;
// Cell-patches inspector panel is a dev-only debugging view.
const DEV_MODE = import.meta.env.DEV;

const MIN_NOTEBOOK_WIDTH_PX = 280;
const MIN_CANVAS_BODY_WIDTH_PX = 320;
const MIN_MAIN_HEIGHT_PX = 220;
const MIN_INSPECTOR_HEIGHT_PX = 140;
const DEFAULT_NOTEBOOK_RATIO = 50;
const DEFAULT_MAIN_RATIO = 72;
const KEYBOARD_RESIZE_STEP = 2;
const TAG_ORDER = ["input", "transform", "output", "ai", "io"] as const;
const DEFAULT_JUPYTER_URL = "http://localhost:8888";
const PANEL_STORAGE_KEY = "notebookflow.panels.v1";
const SETTINGS_STORAGE_KEY = "notebookflow.settings.v1";

type Theme = "light" | "dark" | "system";

interface UserSettings {
  engineUrlOverride: string;
  theme: Theme;
}

const DEFAULT_USER_SETTINGS: UserSettings = {
  engineUrlOverride: "",
  theme: "system",
};

function readUserSettings(): UserSettings {
  if (typeof window === "undefined") {
    return DEFAULT_USER_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_USER_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      engineUrlOverride:
        typeof parsed.engineUrlOverride === "string" ? parsed.engineUrlOverride : "",
      theme:
        parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system"
          ? parsed.theme
          : "system",
    };
  } catch {
    return DEFAULT_USER_SETTINGS;
  }
}

function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") {
    return;
  }
  const wantDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", wantDark);
}

interface PanelLayoutState {
  cellsCollapsed: boolean;
  inspectorCollapsed: boolean;
  filesCollapsed: boolean;
}

const DEFAULT_PANEL_LAYOUT: PanelLayoutState = {
  cellsCollapsed: false,
  inspectorCollapsed: true,
  filesCollapsed: false,
};

function readPanelLayout(): PanelLayoutState {
  if (typeof window === "undefined") {
    return DEFAULT_PANEL_LAYOUT;
  }
  try {
    const raw = window.localStorage.getItem(PANEL_STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_PANEL_LAYOUT;
    }
    const parsed = JSON.parse(raw) as Partial<PanelLayoutState>;
    return {
      cellsCollapsed: parsed.cellsCollapsed === true,
      // Inspector defaults to collapsed; only an explicit false expands it.
      inspectorCollapsed: parsed.inspectorCollapsed !== false,
      filesCollapsed: parsed.filesCollapsed === true,
    };
  } catch {
    return DEFAULT_PANEL_LAYOUT;
  }
}
const JUPYTER_URL: string = (() => {
  const raw = import.meta.env.VITE_NOTEBOOKFLOW_JUPYTER_URL;
  // Undefined env var -> use default. Explicitly empty string -> opt-out, no button.
  if (raw === undefined) {
    return DEFAULT_JUPYTER_URL;
  }
  return raw.trim();
})();

interface LoadedNotebook {
  name: string;
  cells: NotebookCell[];
  doc: IpynbDoc;
}

/** A file open in the workspace. The active file's live content lives in the
 * `notebook` state; this carries the rail's identity (id + name). */
interface OpenFileMeta {
  id: string;
  name: string;
}

/** Frozen editing state of an inactive open file, kept in a ref until it's
 * switched back to. */
interface FileSnapshot {
  cells: NotebookCell[];
  doc: IpynbDoc;
  baseline: string[];
  fileHandle: FileSystemFileHandle | null;
}

function makeFileId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `file-${String(Math.floor(performance.now() * 1000))}`;
}

type DragAxis = "horizontal" | "vertical";

interface DragState {
  axis: DragAxis;
  startCoord: number;
  startRatio: number;
}

export function App(): ReactElement {
  const [notebook, setNotebook] = useState<LoadedNotebook>(() => bootstrapFromFixture());
  // Multi-file workspace. The active file's live content is `notebook`; other
  // open files freeze into snapshotsRef until switched back to.
  const initialFileIdRef = useRef<string>(makeFileId());
  const [openFiles, setOpenFiles] = useState<OpenFileMeta[]>(() => [
    { id: initialFileIdRef.current, name: notebook.name },
  ]);
  const [activeFileId, setActiveFileId] = useState<string>(() => initialFileIdRef.current);
  const [isFilesCollapsed, setIsFilesCollapsed] = useState(() => readPanelLayout().filesCollapsed);
  const snapshotsRef = useRef<Map<string, FileSnapshot>>(new Map());
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
  // The node palette is an on-demand drawer (Alt+A or the "+ Add node"
  // button), not a docked pane — it slides over the canvas and closes
  // after use, reclaiming the width for the graph.
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isCellsCollapsed, setIsCellsCollapsed] = useState(() => readPanelLayout().cellsCollapsed);
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

  // If the user changes the engine URL override in Settings, rebuild the
  // EngineClient so subsequent runs hit the new host.
  useEffect(() => {
    clientRef.current =
      settings.engineUrlOverride === ""
        ? new EngineClient()
        : new EngineClient(settings.engineUrlOverride);
  }, [settings.engineUrlOverride]);

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
        setIsPaletteOpen((open) => !open);
        return;
      }
      if (event.key === "Escape") {
        setIsPaletteOpen((open) => (open ? false : open));
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

  // Opening a node's inspector should be one click: selecting a node expands
  // the (default-collapsed) inspector. Deselecting does not auto-collapse.
  useEffect(() => {
    if (selected !== null) {
      setIsInspectorCollapsed(false);
    }
  }, [selected]);
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const contentRef = useRef<HTMLDivElement | null>(null);
  const topPaneRef = useRef<HTMLDivElement | null>(null);
  const canvasPaneRef = useRef<HTMLDivElement | null>(null);

  // Construct the SyncEngine for the active file. Re-created when the active
  // file changes so the canvas reflects only that notebook (the composed
  // union across files is the separate UI B2 slice). The `[notebook]` ingest
  // effect below repopulates it after each switch / edit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeFileId is the intended reset trigger, not read in the body
  useEffect(() => {
    const engine = new SyncEngine({
      onGraphUpdate: setGraph,
      onCellPatch: (patch: CellPatch): Promise<void> => {
        setPatches((prev) => [...prev, patch]);
        setNotebook((prev) => applyCellPatch(prev, patch));
        return Promise.resolve();
      },
    });
    engineRef.current = engine;
  }, [activeFileId]);

  // Re-ingest whenever the cell array changes.
  useEffect(() => {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    void engine.ingestNotebook(notebook.name, notebook.cells, Date.now());
  }, [notebook]);

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

  // Persist panel collapse state so reloads keep the user's layout.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(
        PANEL_STORAGE_KEY,
        JSON.stringify({
          cellsCollapsed: isCellsCollapsed,
          inspectorCollapsed: isInspectorCollapsed,
          filesCollapsed: isFilesCollapsed,
        }),
      );
    } catch {
      // Quota / disabled storage -- silently keep working in-memory.
    }
  }, [isCellsCollapsed, isInspectorCollapsed, isFilesCollapsed]);

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
        const message = err instanceof Error ? err.message : "unknown error";
        setError(`Failed to load ${name}: ${message}`);
      }
    },
    [openFiles, snapshotActive, switchToFile, resetTransient],
  );

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

  const handleCellsChange = useCallback((next: NotebookCell[]): void => {
    setNotebook((prev) => ({ ...prev, cells: next }));
  }, []);

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

  const handleAddNode = useCallback(
    (manifest: NodeManifestDef): void => {
      const engine = engineRef.current;
      if (engine === null) {
        return;
      }
      const config = defaultConfigForManifest(manifest);
      setError(null);
      void clientRef.current
        .synthesizeNode({
          manifestId: manifest.id,
          nodeName: manifest.name,
          inputs: [],
          outputs: manifest.outputs.map((port) => port.name),
          config,
          currentSource: "",
        })
        .then(async (result) => {
          const metadata = writeNotebookflowMetadata(undefined, {
            manifestId: manifest.id,
            manifestVersion: manifest.version,
            config,
            lastGeneratedAt: new Date().toISOString(),
            lastGenerationBackend: result.backend,
          });
          await engine.createNode(
            notebook.name,
            {
              name: manifest.name,
              tag: manifest.tag,
              outputs: manifest.outputs.map((port) => port.name),
              bodySource: result.source,
              metadata,
            },
            Date.now(),
          );
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "unknown error";
          setError(`Could not add ${manifest.name}: ${message}`);
        });
    },
    [notebook.name],
  );

  // Drag-from-palette drop handler: look the manifest up by id, then funnel
  // through the same add-node flow as a click. The drop position is currently
  // ignored at the SyncEngine layer (node layout is derived from cellIndex);
  // wiring positional metadata into cell metadata is left to a follow-up.
  const handlePaneDrop = useCallback(
    (manifestId: string, _position: { x: number; y: number }): void => {
      const manifest = paletteNodes.find((entry) => entry.id === manifestId);
      if (manifest === undefined) {
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
        const message = err instanceof Error ? err.message : "unknown error";
        setPaletteError(`Could not load node registry: ${message}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    () => buildPipelineDef(graph, notebook.cells, notebook.name),
    [graph, notebook],
  );

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
      const message = err instanceof Error ? err.message : "unknown error";
      setError(`Could not explain pipeline: ${message}`);
    } finally {
      setIsExplaining(false);
    }
  }, [isExplaining, pipelineDef]);

  const handleCompose = useCallback(async (): Promise<void> => {
    if (composePrompt.trim() === "") {
      setComposeError("Type a sentence describing the pipeline you want.");
      return;
    }
    setIsComposing(true);
    setComposeError(null);
    try {
      const result = await clientRef.current.proposePipeline(composePrompt.trim());
      setComposeResult(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      setComposeError(`Could not compose pipeline: ${message}`);
    } finally {
      setIsComposing(false);
    }
  }, [composePrompt]);

  const refreshTriggers = useCallback(async (): Promise<void> => {
    setIsLoadingTriggers(true);
    setTriggersError(null);
    try {
      const list = await clientRef.current.listTriggers();
      setTriggers(list);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      setTriggersError(`Could not load triggers: ${message}`);
    } finally {
      setIsLoadingTriggers(false);
    }
  }, []);

  useEffect(() => {
    if (!isTriggersOpen) {
      return;
    }
    void refreshTriggers();
  }, [isTriggersOpen, refreshTriggers]);

  const handleAsk = useCallback(async (): Promise<void> => {
    if (askPrompt.trim() === "") {
      setAskError("Ask a question or describe what you'd like to do.");
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
      const message = err instanceof Error ? err.message : "unknown error";
      setAskError(`Could not reach the engine: ${message}`);
    } finally {
      setIsAsking(false);
    }
  }, [askPrompt, pipelineDef]);

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
        const message = err instanceof Error ? err.message : "unknown error";
        setConfigError(`Could not update ${selected.name}: ${message}`);
      })
      .finally(() => {
        setIsConfigSubmitting(false);
      });
  }, [configDraft, notebook.cells, selected, selectedManifest]);

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
        const message = err instanceof Error ? err.message : "unknown error";
        setError(`Pipeline run failed: ${message}`);
      })
      .finally(() => {
        setIsRunning(false);
        setStreamingCellIndex(null);
      });
  }, [isRunning, pipelineDef, graph]);

  const handleDownload = useCallback((): void => {
    downloadNotebook(notebook.cells, notebook.doc, notebook.name, outputsByCell);
    setBaselineSources(notebook.cells.map((cell) => cell.source));
  }, [notebook, outputsByCell]);

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
              description: "Jupyter notebook",
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
      const message = err instanceof Error ? err.message : "unknown error";
      setError(`Save failed: ${message}`);
    }
  }, [notebook, outputsByCell]);

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

  const contentStyle = useMemo(
    () =>
      isInspectorCollapsed
        ? { gridTemplateRows: "minmax(0, 1fr) 0px auto" }
        : {
            gridTemplateRows: `minmax(${MIN_MAIN_HEIGHT_PX}px, ${mainRatio}%) ${DIVIDER_SIZE_PX}px minmax(${MIN_INSPECTOR_HEIGHT_PX}px, calc(${100 - mainRatio}% - ${DIVIDER_SIZE_PX}px))`,
          },
    [isInspectorCollapsed, mainRatio],
  );

  const topPaneStyle = useMemo(
    () =>
      isCellsCollapsed
        ? { gridTemplateColumns: `${DIVIDER_SIZE_PX}px minmax(${MIN_CANVAS_BODY_WIDTH_PX}px, 1fr)` }
        : {
            gridTemplateColumns: `minmax(${MIN_NOTEBOOK_WIDTH_PX}px, ${notebookRatio}%) ${DIVIDER_SIZE_PX}px minmax(${MIN_CANVAS_BODY_WIDTH_PX}px, calc(${100 - notebookRatio}% - ${DIVIDER_SIZE_PX}px))`,
          },
    [isCellsCollapsed, notebookRatio],
  );

  return (
    <FileDropZone onFile={handleFile}>
      <div className="flex h-screen overflow-hidden flex-col bg-background text-foreground font-sans">
        <header className="flex items-center gap-3 border-b bg-card px-4 py-2.5">
          <span className="font-semibold tracking-tight">NotebookFlow</span>
          <EngineStatus client={clientRef.current} />
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                className="px-2"
                onClick={() => {
                  setIsOverflowOpen((open) => !open);
                }}
                title="More actions"
                aria-label="More actions"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
              {isOverflowOpen && (
                <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-md border bg-popover text-popover-foreground shadow-md">
                  <button
                    type="button"
                    onClick={() => {
                      handleReingest();
                      setIsOverflowOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-muted/70"
                  >
                    <RotateCcw className="size-3.5" />
                    Re-ingest
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
                      Edit in JupyterLab
                    </button>
                  )}
                </div>
              )}
            </div>
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
                    ? "Pick a file once; subsequent saves overwrite it"
                    : "Save changes back to disk"
                }
              >
                <Save className="mr-1.5 size-3.5" />
                {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : "Save"}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="mr-1.5 size-3.5" />
              Download
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsTriggersOpen(true);
              }}
              title="Manage triggers (manual / cron / file-watch / webhook)"
            >
              <Zap className="mr-1.5 size-3.5" />
              Triggers
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
              title="Ask Claude (or the template fallback) to describe what this pipeline does"
            >
              <Sparkles className="mr-1.5 size-3.5" />
              {isExplaining ? "Explaining…" : "Explain"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsComposeOpen(true);
              }}
              title="Describe a pipeline in plain English; Claude (or the template fallback) drafts the cells"
            >
              <Wand2 className="mr-1.5 size-3.5" />
              Compose
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsAskOpen(true);
              }}
              title="Ask AI anything about your pipeline (Cmd/Ctrl+K)"
            >
              <Command className="mr-1.5 size-3.5" />
              Ask AI
              <Badge variant="outline" className="ml-2 px-1 font-mono text-[10px]">
                ⌘K
              </Badge>
            </Button>
            <Button variant="default" size="sm" onClick={handleRun} disabled={isRunning}>
              <Play className="mr-1.5 size-3.5" />
              {isRunning ? "Running…" : "Run pipeline"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="px-2"
              title="Keyboard shortcuts (?)"
              aria-label="Keyboard shortcuts"
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
              title="Settings"
              aria-label="Settings"
              onClick={() => {
                setIsSettingsOpen((open) => !open);
              }}
            >
              <SettingsIcon className="size-4" />
            </Button>
          </div>
        </header>

        {isSettingsOpen && (
          <SettingsDialog
            settings={settings}
            onChange={setSettings}
            onClose={() => {
              setIsSettingsOpen(false);
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
            onSelect={switchToFile}
            onClose={closeFile}
            onOpen={triggerOpenFile}
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
              {!isCellsCollapsed && (
                <section className="flex min-h-0 min-w-0 flex-col">
                  <CellToolbar
                    focusedCellIndex={focusedCellIndex}
                    focusedCell={
                      focusedCellIndex === null ? null : (notebook.cells[focusedCellIndex] ?? null)
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
                      scrollToCellIndex={selected?.cellIndices[0] ?? null}
                      focusedCellIndex={focusedCellIndex}
                      onFocusCell={setFocusedCellIndex}
                      streamingCellIndex={streamingCellIndex}
                    />
                  </ScrollArea>
                  <CellPaneFooter cells={notebook.cells} isDirty={isDirty} />
                </section>
              )}

              {isCellsCollapsed ? (
                <div className="flex w-full items-start justify-center border-r bg-muted/30 py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1.5"
                    title="Expand cell pane"
                    onClick={() => {
                      setIsCellsCollapsed(false);
                    }}
                  >
                    <PanelLeftOpen className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <PaneDivider
                  orientation="vertical"
                  label="Resize notebook and canvas panes"
                  onPointerDown={handleVerticalDividerPointerDown}
                  onKeyDown={handleVerticalDividerKeyDown}
                />
              )}

              <section className="flex min-h-0 min-w-0 flex-col">
                <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
                  <span>Canvas</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => {
                      setIsPaletteOpen(true);
                    }}
                    title="Add a node — opens the palette (Alt+A)"
                  >
                    <Plus className="mr-1 size-3.5" />
                    Add node
                  </Button>
                </div>
                <div
                  ref={canvasPaneRef}
                  className="relative min-h-0 flex-1 overflow-hidden bg-background"
                >
                  <Canvas
                    graph={graph}
                    onNodeRename={handleRename}
                    onNodeSelect={setSelected}
                    onInputsChange={handleInputsChange}
                    onOutputsChange={handleOutputsChange}
                    variablesByNode={variablesByNode}
                    runtimeByNode={runtimeByNode}
                    timingByNode={timingByNode}
                    metaByNode={metaByNode}
                    runSummary={runSummary}
                    onPaneDrop={handlePaneDrop}
                    showMinimap={showMinimap}
                    onToggleMinimap={() => {
                      setShowMinimap((on) => !on);
                    }}
                  />
                  {isPaletteOpen && (
                    <PaletteDrawer
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
                        setIsPaletteOpen(false);
                      }}
                      onClose={() => {
                        setIsPaletteOpen(false);
                      }}
                    />
                  )}
                </div>
              </section>
            </div>

            {!isInspectorCollapsed && (
              <PaneDivider
                orientation="horizontal"
                label="Resize editor and inspector panes"
                onPointerDown={handleHorizontalDividerPointerDown}
                onKeyDown={handleHorizontalDividerKeyDown}
              />
            )}

            <aside className="flex min-h-0 flex-col bg-muted/30 text-xs">
              <button
                type="button"
                onClick={() => {
                  setIsInspectorCollapsed((open) => !open);
                }}
                className="flex items-center gap-2 border-t px-4 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-muted/50"
                aria-label={isInspectorCollapsed ? "Expand inspector" : "Collapse inspector"}
              >
                {isInspectorCollapsed ? (
                  <ChevronRight className="size-3" />
                ) : (
                  <ChevronDown className="size-3" />
                )}
                <span className="uppercase tracking-wider">Inspector</span>
                {selected !== null && (
                  <span className="font-mono text-[10px]">· {selected.name}</span>
                )}
                {events.length > 0 && (
                  <span className="font-mono text-[10px]">· {events.length} events</span>
                )}
              </button>
              {!isInspectorCollapsed && (
                <div
                  className={cn(
                    "grid min-h-0 flex-1 divide-x",
                    DEV_MODE ? "grid-cols-3" : "grid-cols-2",
                  )}
                >
                  <InspectorPanel
                    title="Selected"
                    count={selected === null ? 0 : 1}
                    empty="Click a node."
                  >
                    {selected !== null &&
                    selectedManifest !== null &&
                    selectedManifest.configFields.length > 0 ? (
                      <NodeConfigEditor
                        manifest={selectedManifest}
                        values={configDraft}
                        isDirty={isConfigDirty}
                        isSubmitting={isConfigSubmitting}
                        isDisabled={isConfigBlocked}
                        error={configError}
                        warnings={configWarnings}
                        status={configStatus}
                        onChange={(key, value) => {
                          setConfigDraft((current) => ({ ...current, [key]: value }));
                        }}
                        onSubmit={handleApplySelectedConfig}
                      />
                    ) : (
                      <pre className="overflow-x-auto rounded-md border bg-background p-2 font-mono text-[11px]">
                        {JSON.stringify(selected, null, 2)}
                      </pre>
                    )}
                  </InspectorPanel>

                  <InspectorPanel
                    title="Execution events"
                    count={events.length}
                    empty="Click Run to dispatch this pipeline."
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
                      title="Cell patches"
                      count={patches.length}
                      empty="Rename a node in the canvas to see one."
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
                              cell {patch.cellIndex}
                            </Badge>
                          </div>
                          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px]">
                            {patch.newSource ?? "(deleted)"}
                          </pre>
                        </div>
                      ))}
                    </InspectorPanel>
                  )}
                </div>
              )}
            </aside>
          </div>
        </div>
      </div>
    </FileDropZone>
  );
}

interface PaneDividerProps {
  orientation: DragAxis;
  label: string;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}

function PaneDivider({
  orientation,
  label,
  onPointerDown,
  onKeyDown,
}: PaneDividerProps): ReactElement {
  const isVertical = orientation === "vertical";

  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        "group relative flex shrink-0 touch-none select-none items-center justify-center border-0 bg-muted/70 p-0",
        isVertical ? "h-full cursor-col-resize" : "w-full cursor-row-resize",
      )}
    >
      <div
        className={cn(
          "rounded-full bg-border transition-colors group-hover:bg-foreground/30 group-active:bg-foreground/45",
          isVertical ? "h-14 w-1" : "h-1 w-14",
        )}
      />
    </button>
  );
}

interface InspectorPanelProps {
  title: string;
  count: number;
  empty: string;
  children?: React.ReactNode;
}

function InspectorPanel({ title, count, empty, children }: InspectorPanelProps): ReactElement {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {title}
        <Badge variant="outline" className="font-mono text-[10px]">
          {count}
        </Badge>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-3">
          {count === 0 ? (
            <p className="text-[11px] italic text-muted-foreground">{empty}</p>
          ) : (
            children
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

interface CellPaneFooterProps {
  cells: NotebookCell[];
  isDirty: boolean;
}

function CellPaneFooter({ cells, isDirty }: CellPaneFooterProps): ReactElement {
  const counts = { code: 0, markdown: 0, raw: 0 };
  for (const cell of cells) {
    if (cell.cellType === "code") {
      counts.code += 1;
    } else if (cell.cellType === "markdown") {
      counts.markdown += 1;
    } else {
      counts.raw += 1;
    }
  }
  const total = cells.length;
  return (
    <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-1.5 text-[10px] text-muted-foreground">
      <div className="flex items-center gap-3 font-mono">
        <span>
          {total} {total === 1 ? "cell" : "cells"}
        </span>
        {counts.code > 0 && <span>{counts.code} code</span>}
        {counts.markdown > 0 && <span>{counts.markdown} md</span>}
        {counts.raw > 0 && <span>{counts.raw} raw</span>}
      </div>
      <div className="flex items-center gap-3 font-mono">
        <span
          className={cn(
            "inline-flex items-center gap-1",
            isDirty ? "text-amber-600" : "text-emerald-600",
          )}
        >
          <span
            role="img"
            aria-label={isDirty ? "Modified" : "In sync"}
            className={cn(
              "inline-block size-1.5 rounded-full",
              isDirty ? "bg-amber-500" : "bg-emerald-500",
            )}
          />
          {isDirty ? "modified" : "in sync"}
        </span>
        <span title="Edits re-ingest after a 300ms idle window">auto-ingest 300ms</span>
      </div>
    </div>
  );
}

interface SettingsDialogProps {
  settings: UserSettings;
  onChange: (next: UserSettings) => void;
  onClose: () => void;
}

function SettingsDialog({ settings, onChange, onClose }: SettingsDialogProps): ReactElement {
  return (
    <div className="border-b bg-card/95 backdrop-blur px-4 py-3 shadow-sm">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-semibold tracking-tight">Settings</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5"
            onClick={onClose}
            aria-label="Close settings"
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Engine URL override</span>
          <input
            type="text"
            value={settings.engineUrlOverride}
            onChange={(event) => {
              onChange({ ...settings, engineUrlOverride: event.target.value });
            }}
            placeholder="ws://localhost:8765/ws  (leave blank to use VITE_NOTEBOOKFLOW_ENGINE_URL)"
            className="rounded-md border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-[10px] italic text-muted-foreground">
            Connects to a different engine on the next pipeline run. Leave blank to use the env-var
            default.
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Theme</span>
          <select
            value={settings.theme}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "light" || value === "dark" || value === "system") {
                onChange({ ...settings, theme: value });
              }
            }}
            className="rounded-md border bg-background px-2 py-1 text-[11px]"
          >
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </div>
    </div>
  );
}

interface ExplanationPanelProps {
  explanation: PipelineExplanation;
  onClose: () => void;
}

function ExplanationPanel({ explanation, onClose }: ExplanationPanelProps): ReactElement {
  return (
    <div className="border-b bg-card/95 px-4 py-3 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-primary" />
            <span className="font-semibold tracking-tight">Pipeline explanation</span>
            <Badge variant="outline" className="font-mono text-[10px]">
              {explanation.backend}
            </Badge>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5"
            onClick={onClose}
            aria-label="Dismiss explanation"
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <p className="whitespace-pre-wrap leading-relaxed text-foreground">{explanation.prose}</p>
        {explanation.warnings.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
            {explanation.warnings.map((warning, idx) => (
              <li key={`warning-${String(idx)}`}>• {warning}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface ComposeDialogProps {
  prompt: string;
  isComposing: boolean;
  result: PipelineProposal | null;
  errorMessage: string | null;
  onPromptChange: (next: string) => void;
  onSubmit: () => void;
  onApply: () => void;
  onClose: () => void;
}

function ComposeDialog({
  prompt,
  isComposing,
  result,
  errorMessage,
  onPromptChange,
  onSubmit,
  onApply,
  onClose,
}: ComposeDialogProps): ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-6 backdrop-blur">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-md border bg-card p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Wand2 className="size-4 text-primary" />
            Compose a pipeline
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
        <textarea
          rows={4}
          value={prompt}
          onChange={(event) => {
            onPromptChange(event.target.value);
          }}
          placeholder="e.g. Load customers.csv, filter for EU rows, plot revenue by region"
          aria-label="Pipeline description"
          className="resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        {errorMessage !== null && (
          <p className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
            {errorMessage}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" onClick={onSubmit} disabled={isComposing}>
            {isComposing ? "Drafting…" : "Draft pipeline"}
          </Button>
          {result !== null && result.cellSources.length > 0 && (
            <Button variant="outline" size="sm" onClick={onApply}>
              Replace notebook with draft
            </Button>
          )}
          {result !== null && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {result.backend}
            </Badge>
          )}
        </div>
        {result !== null && (
          <ScrollArea className="min-h-[120px] flex-1 rounded border bg-muted/30 p-2">
            <ul className="flex flex-col gap-1.5 text-[11px] font-mono">
              {result.nodes.map((node, idx) => (
                <li key={`node-${String(idx)}`} className="rounded border bg-background px-2 py-1">
                  <span className="font-semibold">
                    {idx + 1}. {node.name}
                  </span>
                  <span className="ml-2 text-muted-foreground">{node.manifestId}</span>
                </li>
              ))}
            </ul>
            {result.edges.length > 0 && (
              <p className="mt-2 text-[10px] text-muted-foreground">
                {result.edges.map((edge) => `${edge.from} → ${edge.to}`).join("  ·  ")}
              </p>
            )}
            {result.warnings.length > 0 && (
              <ul className="mt-2 flex flex-col gap-0.5 text-[10px] text-muted-foreground">
                {result.warnings.map((warning, idx) => (
                  <li key={`warning-${String(idx)}`}>• {warning}</li>
                ))}
              </ul>
            )}
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

interface AskPaletteProps {
  prompt: string;
  isAsking: boolean;
  result: AskAnswer | null;
  errorMessage: string | null;
  onPromptChange: (next: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

function AskPalette({
  prompt,
  isAsking,
  result,
  errorMessage,
  onPromptChange,
  onSubmit,
  onClose,
}: AskPaletteProps): ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);
  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-6 pt-[15vh] backdrop-blur">
      <div className="flex max-h-[70vh] w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-md border bg-card p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Command className="size-4 text-primary" />
            Ask AI
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
        <textarea
          ref={textareaRef}
          rows={3}
          value={prompt}
          onChange={(event) => {
            onPromptChange(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything — describe what you want to do, request an explanation, or ask a pandas question"
          aria-label="Ask AI prompt"
          className="resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        {errorMessage !== null && (
          <p className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
            {errorMessage}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" onClick={onSubmit} disabled={isAsking}>
            {isAsking ? "Thinking…" : "Ask"}
          </Button>
          {result !== null && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {result.backend}
            </Badge>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            ⌘/Ctrl+Enter to send · Esc to close
          </span>
        </div>
        {result !== null && (
          <ScrollArea className="min-h-[120px] flex-1 rounded border bg-muted/30 p-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.answer}</p>
            {result.warnings.length > 0 && (
              <ul className="mt-3 flex flex-col gap-0.5 text-[10px] text-muted-foreground">
                {result.warnings.map((warning, idx) => (
                  <li key={`ask-warning-${String(idx)}`}>• {warning}</li>
                ))}
              </ul>
            )}
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Triggers (#20). Backed by the /triggers REST surface that shipped with #8.
// The default on_fire callback on the engine just logs -- "this trigger
// fired" is the signal, "the pipeline auto-ran" is future work. We hide
// pipelineId from the form to avoid implying otherwise.
// ---------------------------------------------------------------------------

const TRIGGER_KIND_LABEL: Record<TriggerKind, string> = {
  manual: "Manual",
  cron: "Cron",
  file_watch: "File watch",
  webhook: "Webhook",
};

const CRON_PRESETS: { label: string; expression: string }[] = [
  { label: "Every 5 min", expression: "*/5 * * * *" },
  { label: "Hourly", expression: "0 * * * *" },
  { label: "Daily 9am", expression: "0 9 * * *" },
];

const CRON_REGEX = /^(\S+\s+){4}\S+$/;

interface TriggersDialogProps {
  client: EngineClient;
  triggers: TriggerSpec[];
  errorMessage: string | null;
  isLoading: boolean;
  onRefresh: () => void;
  onClose: () => void;
}

function TriggersDialog({
  client,
  triggers,
  errorMessage,
  isLoading,
  onRefresh,
  onClose,
}: TriggersDialogProps): ReactElement {
  const [isCreating, setIsCreating] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-6 pt-[10vh] backdrop-blur">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-md border bg-card p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Zap className="size-4 text-primary" />
            Triggers
            <Badge variant="outline" className="font-mono text-[10px]">
              {triggers.length}
            </Badge>
          </span>
          <div className="flex items-center gap-1">
            {!isCreating && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsCreating(true);
                }}
              >
                <Plus className="mr-1.5 size-3.5" />
                New trigger
              </Button>
            )}
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
        </div>
        {errorMessage !== null && (
          <p className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
            {errorMessage}
          </p>
        )}
        {isCreating ? (
          <TriggerCreateForm
            client={client}
            onCancel={() => {
              setIsCreating(false);
            }}
            onCreated={() => {
              setIsCreating(false);
              onRefresh();
            }}
          />
        ) : (
          <ScrollArea className="min-h-[200px] flex-1 rounded border bg-muted/30 p-2">
            {triggers.length === 0 ? (
              <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                {isLoading
                  ? "Loading triggers…"
                  : "No triggers yet. Click 'New trigger' to register one."}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {triggers.map((trigger) => (
                  <TriggerListItem
                    key={trigger.id}
                    client={client}
                    trigger={trigger}
                    onChanged={onRefresh}
                  />
                ))}
              </ul>
            )}
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

interface TriggerCreateFormProps {
  client: EngineClient;
  onCancel: () => void;
  onCreated: () => void;
}

function TriggerCreateForm({ client, onCancel, onCreated }: TriggerCreateFormProps): ReactElement {
  const [kind, setKind] = useState<TriggerKind>("manual");
  const [id, setId] = useState(() => `trigger-${Date.now().toString(36)}`);
  const [expression, setExpression] = useState("");
  const [pathsText, setPathsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const cronShapeOk = expression.trim() === "" || CRON_REGEX.test(expression.trim());

  async function handleSubmit(): Promise<void> {
    if (id.trim() === "") {
      setError("Trigger id can't be empty.");
      return;
    }
    let config: Record<string, unknown> = {};
    if (kind === "cron") {
      if (expression.trim() === "") {
        setError("Cron expression required.");
        return;
      }
      config = { expression: expression.trim() };
    } else if (kind === "file_watch") {
      const paths = pathsText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
      if (paths.length === 0) {
        setError("Add at least one path to watch.");
        return;
      }
      config = { paths };
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await client.registerTrigger({
        id: id.trim(),
        kind,
        pipelineId: "default",
        config,
      });
      onCreated();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-1">
        {(Object.keys(TRIGGER_KIND_LABEL) as TriggerKind[]).map((k) => (
          <Button
            key={k}
            variant={kind === k ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              setKind(k);
              setError(null);
            }}
          >
            {TRIGGER_KIND_LABEL[k]}
          </Button>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-[11px]">
        <span className="text-muted-foreground">Trigger id</span>
        <input
          value={id}
          onChange={(event) => {
            setId(event.target.value);
          }}
          className="rounded border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
          aria-label="Trigger id"
        />
      </label>
      {kind === "cron" && (
        <div className="flex flex-col gap-1.5 text-[11px]">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Cron expression (5 fields)</span>
            <input
              value={expression}
              onChange={(event) => {
                setExpression(event.target.value);
              }}
              placeholder="*/5 * * * *"
              className="rounded border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
              aria-label="Cron expression"
            />
          </label>
          {!cronShapeOk && (
            <span className="text-[10px] text-amber-600">
              5 whitespace-separated fields expected; engine validates on save.
            </span>
          )}
          <div className="flex flex-wrap gap-1">
            {CRON_PRESETS.map((preset) => (
              <Button
                key={preset.expression}
                variant="outline"
                size="sm"
                className="h-6 px-2 font-mono text-[10px]"
                onClick={() => {
                  setExpression(preset.expression);
                }}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
      )}
      {kind === "file_watch" && (
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="text-muted-foreground">Paths (one per line)</span>
          <textarea
            value={pathsText}
            onChange={(event) => {
              setPathsText(event.target.value);
            }}
            rows={3}
            placeholder="./data&#10;./inputs"
            className="resize-none rounded border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
            aria-label="Paths to watch"
          />
          <span className="text-[10px] text-muted-foreground">
            Engine-host paths. Directories are watched recursively.
          </span>
        </label>
      )}
      {kind === "webhook" && (
        <p className="text-[11px] text-muted-foreground">
          A POST URL will be generated after you save. Anyone posting to it fires this trigger.
        </p>
      )}
      {kind === "manual" && (
        <p className="text-[11px] text-muted-foreground">
          Fires only when you click <strong>Fire now</strong> in the list.
        </p>
      )}
      {error !== null && (
        <p className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={() => {
            void handleSubmit();
          }}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Saving…" : "Save trigger"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface TriggerListItemProps {
  client: EngineClient;
  trigger: TriggerSpec;
  onChanged: () => void;
}

function TriggerListItem({ client, trigger, onChanged }: TriggerListItemProps): ReactElement {
  const [isExpanded, setIsExpanded] = useState(false);
  const [firings, setFirings] = useState<TriggerFiring[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isFiring, setIsFiring] = useState(false);
  const [copied, setCopied] = useState(false);

  // Manual triggers only fire from this UI -- no point polling them.
  const shouldPoll = isExpanded && trigger.kind !== "manual";

  useEffect(() => {
    if (!isExpanded) {
      return;
    }
    let cancelled = false;
    async function refresh(): Promise<void> {
      try {
        const list = await client.listFirings(trigger.id);
        if (!cancelled) {
          setFirings(list);
        }
      } catch {
        // Quietly drop; the firings count badge stays at its prior value.
      }
    }
    void refresh();
    if (!shouldPoll) {
      return () => {
        cancelled = true;
      };
    }
    const interval = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [client, trigger.id, isExpanded, shouldPoll]);

  async function handleFire(): Promise<void> {
    setIsFiring(true);
    setActionError(null);
    try {
      const firing = await client.fireTrigger(trigger.id);
      setFirings((prev) => [...prev, firing]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      setActionError(`Fire failed: ${message}`);
    } finally {
      setIsFiring(false);
    }
  }

  async function handleDelete(): Promise<void> {
    setActionError(null);
    try {
      await client.unregisterTrigger(trigger.id);
      onChanged();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      setActionError(`Delete failed: ${message}`);
    }
  }

  const webhookUrl = trigger.kind === "webhook" ? client.webhookUrl(trigger.id) : "";

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      setActionError("Copy failed; select the URL manually.");
    }
  }

  return (
    <li className="rounded border bg-background p-2 text-[12px]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setIsExpanded((prev) => !prev);
          }}
          className="flex flex-1 items-center gap-2 text-left"
          aria-label={isExpanded ? "Collapse trigger" : "Expand trigger"}
        >
          {isExpanded ? (
            <ChevronDown className="size-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground" />
          )}
          <Badge variant="outline" className="font-mono text-[10px]">
            {TRIGGER_KIND_LABEL[trigger.kind]}
          </Badge>
          <span className="truncate font-mono text-[11px]">{trigger.id}</span>
          <span className="text-[10px] text-muted-foreground">
            {firings.length > 0 && `${String(firings.length)} firings`}
          </span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={() => {
            void handleFire();
          }}
          disabled={isFiring}
        >
          <Play className="mr-1 size-3" />
          Fire now
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-destructive"
          onClick={() => {
            void handleDelete();
          }}
          aria-label="Delete trigger"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
      {actionError !== null && (
        <p className="mt-1.5 rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[10px] text-destructive">
          {actionError}
        </p>
      )}
      {isExpanded && trigger.kind === "webhook" && (
        <div className="mt-2 flex flex-col gap-1 rounded border bg-muted/50 p-2 font-mono text-[10px]">
          <div className="flex items-center justify-between gap-2">
            <code className="break-all">POST {webhookUrl}</code>
            <Button
              variant="outline"
              size="sm"
              className="h-6 shrink-0 px-2 text-[10px]"
              onClick={() => {
                void handleCopy();
              }}
            >
              <Copy className="mr-1 size-3" />
              {copied ? "Copied" : "Copy URL"}
            </Button>
          </div>
          <span className="text-muted-foreground">
            Content-Type: application/json · Body: {"{"}&quot;payload&quot;: {"{...}"}
            {"}"}
          </span>
          <span className="text-muted-foreground">
            If NOTEBOOKFLOW_AUTH_TOKEN is set on your engine, include Authorization: Bearer
            &lt;token&gt;.
          </span>
        </div>
      )}
      {isExpanded && Object.keys(trigger.config).length > 0 && trigger.kind !== "webhook" && (
        <pre className="mt-2 overflow-x-auto rounded border bg-muted/50 px-2 py-1 font-mono text-[10px]">
          {JSON.stringify(trigger.config, null, 2)}
        </pre>
      )}
      {isExpanded && (
        <div className="mt-2 flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground">
            Firings (last {firings.length}){shouldPoll && " · refreshes every 5s"}
          </span>
          {firings.length === 0 ? (
            <p className="rounded border bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
              No firings yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5 font-mono text-[10px]">
              {firings
                .slice()
                .reverse()
                .map((firing, idx) => (
                  <li
                    key={`${String(firing.firedAt)}-${String(idx)}`}
                    className="rounded border bg-muted/30 px-2 py-1"
                  >
                    <span className="text-muted-foreground">
                      {new Date(firing.firedAt * 1000).toLocaleTimeString()}
                    </span>
                    {Object.keys(firing.payload).length > 0 && (
                      <span className="ml-2 text-foreground/70">
                        {truncate(JSON.stringify(firing.payload), 80)}
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

/** True when the event target is a text-editing surface (input/textarea/CodeMirror). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    target.isContentEditable ||
    target.closest(".cm-editor") !== null
  );
}

interface PaletteDrawerProps {
  nodes: NodeManifestDef[];
  filteredNodes: NodeManifestDef[];
  error: string | null;
  search: string;
  tagFilter: Set<NodeManifestDef["tag"]>;
  onSearchChange: (next: string) => void;
  onToggleTag: (tag: NodeManifestDef["tag"]) => void;
  onClearFilters: () => void;
  onPick: (manifest: NodeManifestDef) => void;
  onClose: () => void;
}

// Right-side drawer that replaces the old docked palette pane. Opens via the
// canvas "+ Add node" button or Alt+A; closes on Esc, the X, or after a pick.
// Drag-onto-canvas still works because the drawer doesn't cover the canvas
// with a drop-blocking backdrop.
function PaletteDrawer({
  nodes,
  filteredNodes,
  error,
  search,
  tagFilter,
  onSearchChange,
  onToggleTag,
  onClearFilters,
  onPick,
  onClose,
}: PaletteDrawerProps): ReactElement {
  return (
    <aside className="absolute right-0 top-0 z-20 flex h-full w-72 flex-col border-l bg-card shadow-xl">
      <div className="flex items-center justify-between border-b px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-2">
          Palette
          <Badge variant="outline" className="font-mono text-[10px]">
            {filteredNodes.length === nodes.length
              ? nodes.length
              : `${String(filteredNodes.length)}/${String(nodes.length)}`}
          </Badge>
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5"
          onClick={onClose}
          aria-label="Close palette"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {nodes.length > 0 && (
        <div className="flex flex-col gap-2 border-b px-3 py-2">
          <input
            type="text"
            value={search}
            onChange={(event) => {
              onSearchChange(event.target.value);
            }}
            placeholder="Search nodes…"
            aria-label="Search nodes"
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
              all
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
        <div className="flex flex-col gap-3 p-3">
          {error !== null ? (
            <p className="text-[11px] italic text-muted-foreground">{error}</p>
          ) : nodes.length === 0 ? (
            <p className="text-[11px] italic text-muted-foreground">Loading node registry…</p>
          ) : filteredNodes.length === 0 ? (
            <p className="text-[11px] italic text-muted-foreground">
              No nodes match the current search or filter.
            </p>
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
                      title={`Click to append at the end, or drag onto the canvas to place at the drop point — ${manifest.name}`}
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
    </aside>
  );
}

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "⌘/Ctrl + K", label: "Ask AI" },
  { keys: "Alt + A", label: "Toggle node palette" },
  { keys: "M", label: "Toggle minimap" },
  { keys: "?", label: "This shortcuts list" },
  { keys: "Esc", label: "Close palette / dialog" },
  { keys: "Click", label: "Select node" },
  { keys: "Double-click", label: "Rename node" },
  { keys: "Drag", label: "Pan the canvas" },
  { keys: "⌘/Ctrl + Wheel", label: "Zoom the canvas" },
  { keys: "⌘/Ctrl + Enter", label: "Send (in Ask / Compose)" },
];

function ShortcutsDialog({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-6 pt-[12vh] backdrop-blur">
      <div className="w-full max-w-md rounded-md border bg-card p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Keyboard className="size-4 text-primary" />
            Keyboard shortcuts
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
        <ul className="flex flex-col gap-1.5 text-[12px]">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{s.label}</span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface FilesRailProps {
  files: OpenFileMeta[];
  activeFileId: string;
  activeDirty: boolean;
  collapsed: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onOpen: () => void;
  onToggleCollapse: () => void;
}

// Left-hand workspace explorer: the open notebooks, with open / switch /
// close. The active file's name + dirty dot live here (the top-bar filename
// badge was removed). Collapses to a thin strip.
function FilesRail({
  files,
  activeFileId,
  activeDirty,
  collapsed,
  onSelect,
  onClose,
  onOpen,
  onToggleCollapse,
}: FilesRailProps): ReactElement {
  if (collapsed) {
    return (
      <div className="flex w-9 flex-col items-center border-r bg-muted/30 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-1.5"
          title="Show files"
          aria-label="Show files"
          onClick={onToggleCollapse}
        >
          <Files className="size-3.5" />
        </Button>
      </div>
    );
  }
  return (
    <aside className="flex w-48 shrink-0 flex-col border-r bg-muted/30">
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Files className="size-3.5" />
          Files
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5"
            title="Open notebook"
            aria-label="Open notebook"
            onClick={onOpen}
          >
            <Plus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5"
            title="Hide files"
            aria-label="Hide files"
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
                        aria-label="Unsaved changes"
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
                      aria-label={`Close ${file.name}`}
                      title={`Close ${file.name}`}
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
    </aside>
  );
}

function bootstrapFromFixture(): LoadedNotebook {
  const parsed = parseNotebook(JSON.stringify(twoNode));
  return { name: "two-node.ipynb", cells: parsed.cells, doc: parsed.doc };
}

function bootstrapBaselineSources(): string[] {
  return parseNotebook(JSON.stringify(twoNode)).cells.map((cell) => cell.source);
}

function openInJupyterLab(baseUrl: string, notebookName: string): void {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const safeName = notebookName.split("/").map(encodeURIComponent).join("/");
  const target = `${trimmedBase}/lab/tree/${safeName}`;
  window.open(target, "_blank", "noopener,noreferrer");
}

function buildPipelineDef(
  graph: GraphModel,
  cells: NotebookCell[],
  notebookPath: string,
): PipelineDef {
  const nodes = Object.values(graph.nodes).map((node) => {
    const cellIndex = node.cellIndices[0] ?? 0;
    const source = cells[cellIndex]?.source ?? "";
    return {
      id: node.id,
      name: node.name,
      tag: node.tag,
      inputs: node.inputs,
      outputs: node.outputs,
      source: stripMarkerLine(source),
      notebookPath,
      cellIndices: node.cellIndices,
    };
  });
  const edges = Object.values(graph.wires).map((wire) => ({
    sourceNodeId: wire.sourceNodeId,
    sourcePort: wire.sourcePort,
    targetNodeId: wire.targetNodeId,
    targetPort: wire.targetPort,
  }));
  return { nodes, edges };
}

function stripMarkerLine(source: string): string {
  const newline = source.indexOf("\n");
  if (newline === -1) {
    return "";
  }
  const firstLine = source.slice(0, newline).trim();
  if (firstLine.startsWith("# @node:")) {
    return source.slice(newline + 1);
  }
  return source;
}

function buildGenerationStatus(metadata: {
  lastGeneratedAt?: string;
  lastGenerationBackend?: string;
}): string | null {
  if (metadata.lastGenerationBackend === undefined && metadata.lastGeneratedAt === undefined) {
    return null;
  }
  if (metadata.lastGeneratedAt === undefined) {
    return `Last generated via ${metadata.lastGenerationBackend ?? "template"}.`;
  }
  const when = new Date(metadata.lastGeneratedAt).toLocaleString();
  return `Last generated via ${metadata.lastGenerationBackend ?? "template"} at ${when}.`;
}

function renderEvent(event: EngineEvent): string {
  switch (event.type) {
    case "executionStarted":
      return `▶ started ${event.pipelineId}`;
    case "nodeStarted":
      return `… ${event.nodeId} · running`;
    case "nodeCompleted":
      return `${statusGlyph(event.result.status)} ${event.result.nodeId} · ${event.result.status}${event.result.error ? ` — ${event.result.error}` : ""}`;
    case "pipelineCompleted":
      return `✓ completed (${String(event.results.length)} nodes)`;
    case "error":
      return `✗ error: ${event.message}`;
  }
}

function statusGlyph(status: string): string {
  if (status === "ok") {
    return "✓";
  }
  if (status === "error") {
    return "✗";
  }
  if (status === "skipped") {
    return "↷";
  }
  return "•";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function applyCellPatch(prev: LoadedNotebook, patch: CellPatch): LoadedNotebook {
  if (patch.operation === "insert") {
    if (patch.newSource === null || patch.cellIndex < 0 || patch.cellIndex > prev.cells.length) {
      return prev;
    }
    const nextCell: NotebookCell = {
      cellType: patch.cellType ?? "code",
      source: patch.newSource,
      ...(patch.metadata === undefined ? {} : { metadata: patch.metadata }),
    };
    const nextCells = prev.cells.slice();
    nextCells.splice(patch.cellIndex, 0, nextCell);
    const nextDocCells = prev.doc.cells.slice();
    nextDocCells.splice(patch.cellIndex, 0, toIpynbCell(nextCell));
    return { ...prev, cells: nextCells, doc: { ...prev.doc, cells: nextDocCells } };
  }

  if (patch.operation === "delete") {
    if (patch.cellIndex < 0 || patch.cellIndex >= prev.cells.length) {
      return prev;
    }
    const nextCells = prev.cells.slice();
    nextCells.splice(patch.cellIndex, 1);
    const nextDocCells = prev.doc.cells.slice();
    nextDocCells.splice(patch.cellIndex, 1);
    return { ...prev, cells: nextCells, doc: { ...prev.doc, cells: nextDocCells } };
  }

  if (patch.cellIndex < 0 || patch.cellIndex >= prev.cells.length || patch.newSource === null) {
    return prev;
  }
  const cell = prev.cells[patch.cellIndex];
  const docCell = prev.doc.cells[patch.cellIndex];
  if (cell === undefined || docCell === undefined) {
    return prev;
  }
  const nextMetadata = patch.metadata ?? cell.metadata;
  if (cell.source === patch.newSource && nextMetadata === cell.metadata) {
    return prev;
  }
  const nextCells = prev.cells.slice();
  nextCells[patch.cellIndex] = {
    ...cell,
    source: patch.newSource,
    ...(nextMetadata === undefined ? {} : { metadata: nextMetadata }),
  };
  const nextDocCells = prev.doc.cells.slice();
  nextDocCells[patch.cellIndex] = {
    ...docCell,
    source: [patch.newSource],
    metadata: nextMetadata ?? docCell.metadata ?? {},
  };
  return { ...prev, cells: nextCells, doc: { ...prev.doc, cells: nextDocCells } };
}

function groupPalette(
  nodes: NodeManifestDef[],
): Array<[NodeManifestDef["tag"], NodeManifestDef[]]> {
  const groups: Array<[NodeManifestDef["tag"], NodeManifestDef[]]> = [];
  for (const tag of TAG_ORDER) {
    const groupNodes = nodes.filter((node) => node.tag === tag);
    if (groupNodes.length > 0) {
      groups.push([tag, groupNodes]);
    }
  }
  return groups;
}

function sortPalette(nodes: NodeManifestDef[]): NodeManifestDef[] {
  const rank = new Map(TAG_ORDER.map((tag, idx) => [tag, idx]));
  return [...nodes].sort((left, right) => {
    const tagDelta = (rank.get(left.tag) ?? 999) - (rank.get(right.tag) ?? 999);
    if (tagDelta !== 0) {
      return tagDelta;
    }
    return left.name.localeCompare(right.name);
  });
}
