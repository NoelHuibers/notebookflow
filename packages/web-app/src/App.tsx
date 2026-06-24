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
  WireModel,
} from "@notebookflow/graph-canvas";
import {
  Canvas,
  configValuesEqual,
  defaultConfigForManifest,
  hasMissingRequiredConfig,
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
  Download,
  ExternalLink,
  Keyboard,
  MoreHorizontal,
  PanelLeftOpen,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  Sparkles,
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
import { CellList } from "@/components/CellList";
import { CellPaneFooter } from "@/components/CellPaneFooter";
import type { CellKind } from "@/components/CellToolbar";
import { CellToolbar } from "@/components/CellToolbar";
import { ComposeDialog } from "@/components/ComposeDialog";
import { EngineStatus } from "@/components/EngineStatus";
import { ExplanationPanel } from "@/components/ExplanationPanel";
import { FileDropZone } from "@/components/FileDropZone";
import { FilesRail } from "@/components/FilesRail";
import { InspectorPanel } from "@/components/InspectorPanel";
import { PaletteDrawer } from "@/components/PaletteDrawer";
import { PaneDivider } from "@/components/PaneDivider";
import { SettingsDialog } from "@/components/SettingsDialog";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { TriggersDialog } from "@/components/TriggersDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { bootstrapBaselineSources, bootstrapFromFixture } from "@/lib/bootstrap";
import { applyCellPatch } from "@/lib/cellPatch";
import type {
  AskAnswer,
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
import { openInJupyterLab } from "@/lib/jupyter";
import type { IpynbDoc } from "@/lib/notebook";
import {
  extractSourceFilename,
  parseNotebook,
  serializeNotebook,
  toIpynbCell,
} from "@/lib/notebook";
import { sortPalette } from "@/lib/palette";
import { PANEL_STORAGE_KEY, readPanelLayout } from "@/lib/panels";
import { buildPipelineDef, stripMarkerLine } from "@/lib/pipeline";
import type { UserSettings } from "@/lib/settings";
import { applyTheme, readUserSettings, SETTINGS_STORAGE_KEY } from "@/lib/settings";
import { clamp, cn, isTypingTarget } from "@/lib/utils";
import { downloadWorkspaceZip } from "@/lib/workspaceZip";
import type { DragState, FileSnapshot, LoadedNotebook, OpenFileMeta } from "@/types/workspace";

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

export function App(): ReactElement {
  const [notebook, setNotebook] = useState<LoadedNotebook>(() => bootstrapFromFixture());
  // Multi-file workspace. The active file's live content is `notebook`; other
  // open files freeze into snapshotsRef until switched back to.
  const initialFileIdRef = useRef<string>(makeFileId());
  const [openFiles, setOpenFiles] = useState<OpenFileMeta[]>(() => [
    { id: initialFileIdRef.current, name: notebook.name },
  ]);
  const [activeFileId, setActiveFileId] = useState<string>(() => initialFileIdRef.current);
  // Files list and code cells collapse independently — close files without
  // closing code, and vice-versa.
  const [isFilesCollapsed, setIsFilesCollapsed] = useState(() => readPanelLayout().filesCollapsed);
  const [isCellsCollapsed, setIsCellsCollapsed] = useState(() => readPanelLayout().cellsCollapsed);
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

  // Rebuild the EngineClient when the engine URL changes, and (re)apply the
  // bring-your-own-key credentials whenever the LLM settings change. Both go
  // through one effect so a fresh client never loses its credentials.
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
    clientRef.current = client;
  }, [settings.engineUrlOverride, settings.llmProvider, settings.llmModel, settings.llmApiKey]);

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

  // Cells of every open file, keyed by notebook path (= file name). The active
  // file is live; inactive files come from their frozen snapshots. Drives both
  // the workspace ingest and the composed pipeline's per-node source lookup.
  const cellsByPath = useMemo<Map<string, NotebookCell[]>>(() => {
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
  }, [openFiles, activeFileId, notebook.cells]);

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
        setNotebook((prev) => applyCellPatch(prev, patch));
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
        }),
      );
    } catch {
      // Quota / disabled storage -- silently keep working in-memory.
    }
  }, [isFilesCollapsed, isCellsCollapsed, isInspectorCollapsed]);

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

  // Export every open file's .ipynb as one zip — a single "Download" is
  // ambiguous once the workspace spans multiple files. The active file carries
  // its live cells + run outputs; inactive files come from their snapshots.
  const handleDownloadAll = useCallback(async (): Promise<void> => {
    const files = openFiles.map((file) => {
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
    await downloadWorkspaceZip(files);
    setBaselineSources(notebook.cells.map((cell) => cell.source));
  }, [openFiles, activeFileId, notebook, outputsByCell]);

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
        ? // Code collapsed: a slim strip (wide enough for the expand button)
          // plus the canvas.
          { gridTemplateColumns: `2.25rem minmax(${MIN_CANVAS_BODY_WIDTH_PX}px, 1fr)` }
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
                    Download all (.zip)
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
              {isCellsCollapsed ? (
                <div className="flex w-full items-start justify-center border-r bg-muted/30 py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 px-0"
                    title="Show code"
                    aria-label="Show code"
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
                        scrollToCellIndex={selected?.cellIndices[0] ?? null}
                        focusedCellIndex={focusedCellIndex}
                        onFocusCell={setFocusedCellIndex}
                        streamingCellIndex={streamingCellIndex}
                      />
                    </ScrollArea>
                    <CellPaneFooter cells={notebook.cells} isDirty={isDirty} />
                  </section>
                  <PaneDivider
                    orientation="vertical"
                    label="Resize notebook and canvas panes"
                    onPointerDown={handleVerticalDividerPointerDown}
                    onKeyDown={handleVerticalDividerKeyDown}
                  />
                </>
              )}

              <section className="flex min-h-0 min-w-0 flex-col">
                <div
                  ref={canvasPaneRef}
                  className="relative min-h-0 flex-1 overflow-hidden bg-background"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="absolute left-3 top-3 z-10 h-7 px-2 text-[11px] shadow-sm"
                    onClick={() => {
                      setIsPaletteOpen(true);
                    }}
                    title="Add a node — opens the palette (Alt+A)"
                  >
                    <Plus className="mr-1 size-3.5" />
                    Add node
                  </Button>
                  <Canvas
                    graph={graph}
                    onNodeRename={handleRename}
                    onNodeSelect={setSelected}
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
