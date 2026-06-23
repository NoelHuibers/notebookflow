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
  Download,
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  Sparkles,
  Square,
  Wand2,
  X,
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
  EngineEvent,
  NbOutput,
  PipelineDef,
  PipelineExplanation,
  PipelineProposal,
} from "@/lib/EngineClient";
import { EngineClient } from "@/lib/EngineClient";
import { canSaveInPlace, pickSaveFileHandle, writeFileHandle } from "@/lib/fileSystemAccess";
import type { IpynbDoc } from "@/lib/notebook";
import { downloadNotebook, parseNotebook, serializeNotebook, toIpynbCell } from "@/lib/notebook";
import { cn } from "@/lib/utils";

import twoNode from "./fixtures/two-node.ipynb.json";

const EMPTY_GRAPH: GraphModel = { nodes: {}, groups: {}, wires: {} };
const DIVIDER_SIZE_PX = 10;
const MIN_NOTEBOOK_WIDTH_PX = 280;
const MIN_CANVAS_BODY_WIDTH_PX = 320;
const MIN_PALETTE_WIDTH_PX = 220;
const MIN_MAIN_HEIGHT_PX = 220;
const MIN_INSPECTOR_HEIGHT_PX = 140;
const DEFAULT_NOTEBOOK_RATIO = 50;
const DEFAULT_MAIN_RATIO = 72;
const DEFAULT_PALETTE_WIDTH_PX = 280;
const KEYBOARD_RESIZE_STEP = 2;
const TAG_ORDER = ["input", "transform", "output", "ai", "io"] as const;
const DEFAULT_JUPYTER_URL = "http://localhost:8888";
const PANEL_STORAGE_KEY = "notebookflow.panels.v1";
const SETTINGS_STORAGE_KEY = "notebookflow.settings.v1";

type Trigger = "manual" | "scheduled" | "file-watch";
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
  paletteCollapsed: boolean;
  cellsCollapsed: boolean;
}

const DEFAULT_PANEL_LAYOUT: PanelLayoutState = {
  paletteCollapsed: false,
  cellsCollapsed: false,
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
      paletteCollapsed: parsed.paletteCollapsed === true,
      cellsCollapsed: parsed.cellsCollapsed === true,
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

type DragAxis = "horizontal" | "vertical";

interface DragState {
  axis: DragAxis;
  startCoord: number;
  startRatio: number;
}

export function App(): ReactElement {
  const [notebook, setNotebook] = useState<LoadedNotebook>(() => bootstrapFromFixture());
  const [graph, setGraph] = useState<GraphModel>(EMPTY_GRAPH);
  const [selected, setSelected] = useState<NodeModel | null>(null);
  const [patches, setPatches] = useState<CellPatch[]>([]);
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [outputsByCell, setOutputsByCell] = useState<Record<number, NbOutput[]>>({});
  const [runtimeByNode, setRuntimeByNode] = useState<Record<string, RuntimeState>>({});
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
  const [paletteWidth, setPaletteWidth] = useState(DEFAULT_PALETTE_WIDTH_PX);
  const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(
    () => readPanelLayout().paletteCollapsed,
  );
  const [isCellsCollapsed, setIsCellsCollapsed] = useState(() => readPanelLayout().cellsCollapsed);
  const [trigger, setTrigger] = useState<Trigger>("manual");
  const [settings, setSettings] = useState<UserSettings>(() => readUserSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [explanation, setExplanation] = useState<PipelineExplanation | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [composePrompt, setComposePrompt] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [composeResult, setComposeResult] = useState<PipelineProposal | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [paletteDragState, setPaletteDragState] = useState<{
    startCoord: number;
    startWidth: number;
  } | null>(null);
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
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const contentRef = useRef<HTMLDivElement | null>(null);
  const topPaneRef = useRef<HTMLDivElement | null>(null);
  const canvasPaneRef = useRef<HTMLDivElement | null>(null);

  // Lazily construct the SyncEngine once. We re-call ingest whenever the
  // notebook's cell array changes (drop, edit-debounce, re-ingest button).
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
  }, []);

  // Re-ingest whenever the cell array changes.
  useEffect(() => {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    void engine.ingestNotebook(notebook.name, notebook.cells, Date.now());
  }, [notebook]);

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
          paletteCollapsed: isPaletteCollapsed,
          cellsCollapsed: isCellsCollapsed,
        }),
      );
    } catch {
      // Quota / disabled storage -- silently keep working in-memory.
    }
  }, [isPaletteCollapsed, isCellsCollapsed]);

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

  const handleFile = useCallback((text: string, name: string): void => {
    try {
      const parsed = parseNotebook(text);
      setNotebook({ name, cells: parsed.cells, doc: parsed.doc });
      setBaselineSources(parsed.cells.map((cell) => cell.source));
      setSelected(null);
      setPatches([]);
      setEvents([]);
      setOutputsByCell({});
      setRuntimeByNode({});
      setTimingByNode({});
      setRunSummary(null);
      setStreamingCellIndex(null);
      setFocusedCellIndex(null);
      setExplanation(null);
      fileHandleRef.current = null;
      setSaveStatus("idle");
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      setError(`Failed to load ${name}: ${message}`);
    }
  }, []);

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

  const nodeCount = Object.keys(graph.nodes).length;
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
  const minCanvasPaneWidth = isPaletteCollapsed
    ? MIN_CANVAS_BODY_WIDTH_PX
    : MIN_PALETTE_WIDTH_PX + DIVIDER_SIZE_PX + MIN_CANVAS_BODY_WIDTH_PX;

  const clampNotebookRatio = useCallback(
    (value: number): number => {
      const host = topPaneRef.current;
      if (host === null) {
        return clamp(value, 0, 100);
      }
      const availableWidth = Math.max(host.clientWidth - DIVIDER_SIZE_PX, 1);
      const minRatio = Math.min((MIN_NOTEBOOK_WIDTH_PX / availableWidth) * 100, 50);
      const maxRatio = Math.max(100 - (minCanvasPaneWidth / availableWidth) * 100, 50);
      return clamp(value, minRatio, maxRatio);
    },
    [minCanvasPaneWidth],
  );

  const clampPaletteWidth = useCallback((value: number): number => {
    const host = canvasPaneRef.current;
    if (host === null) {
      return Math.max(value, MIN_PALETTE_WIDTH_PX);
    }
    const maxWidth = Math.max(host.clientWidth - DIVIDER_SIZE_PX - MIN_CANVAS_BODY_WIDTH_PX, 0);
    const minWidth = Math.min(MIN_PALETTE_WIDTH_PX, maxWidth);
    return clamp(value, minWidth, maxWidth);
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

  useEffect(() => {
    if (paletteDragState === null) {
      return;
    }

    const handlePointerMove = (event: PointerEvent): void => {
      const nextWidth = paletteDragState.startWidth - (event.clientX - paletteDragState.startCoord);
      setPaletteWidth(clampPaletteWidth(nextWidth));
    };

    const handlePointerUp = (): void => {
      setPaletteDragState(null);
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
  }, [clampPaletteWidth, paletteDragState]);

  useEffect(() => {
    if (isPaletteCollapsed) {
      return;
    }
    const syncPaletteWidth = (): void => {
      setPaletteWidth((current) => clampPaletteWidth(current));
    };
    syncPaletteWidth();
    window.addEventListener("resize", syncPaletteWidth);
    return () => {
      window.removeEventListener("resize", syncPaletteWidth);
    };
  }, [clampPaletteWidth, isPaletteCollapsed]);

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

  const handlePaletteDividerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      setPaletteDragState({
        startCoord: event.clientX,
        startWidth: paletteWidth,
      });
    },
    [paletteWidth],
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

  const handlePaletteDividerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setPaletteWidth((current) => clampPaletteWidth(current + 16));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setPaletteWidth((current) => clampPaletteWidth(current - 16));
      } else if (event.key === "Home") {
        event.preventDefault();
        setIsPaletteCollapsed(true);
      } else if (event.key === "End") {
        event.preventDefault();
        setPaletteWidth(() => clampPaletteWidth(Number.POSITIVE_INFINITY));
      }
    },
    [clampPaletteWidth],
  );

  const handleTogglePalette = useCallback((): void => {
    if (isPaletteCollapsed) {
      setIsPaletteCollapsed(false);
      setPaletteWidth((current) => {
        const fallbackWidth = current === 0 ? DEFAULT_PALETTE_WIDTH_PX : current;
        return clampPaletteWidth(fallbackWidth);
      });
      return;
    }
    setIsPaletteCollapsed(true);
  }, [clampPaletteWidth, isPaletteCollapsed]);

  const contentStyle = useMemo(
    () => ({
      gridTemplateRows: `minmax(${MIN_MAIN_HEIGHT_PX}px, ${mainRatio}%) ${DIVIDER_SIZE_PX}px minmax(${MIN_INSPECTOR_HEIGHT_PX}px, calc(${100 - mainRatio}% - ${DIVIDER_SIZE_PX}px))`,
    }),
    [mainRatio],
  );

  const topPaneStyle = useMemo(
    () =>
      isCellsCollapsed
        ? { gridTemplateColumns: `${DIVIDER_SIZE_PX}px minmax(${minCanvasPaneWidth}px, 1fr)` }
        : {
            gridTemplateColumns: `minmax(${MIN_NOTEBOOK_WIDTH_PX}px, ${notebookRatio}%) ${DIVIDER_SIZE_PX}px minmax(${minCanvasPaneWidth}px, calc(${100 - notebookRatio}% - ${DIVIDER_SIZE_PX}px))`,
          },
    [isCellsCollapsed, minCanvasPaneWidth, notebookRatio],
  );

  const canvasPaneStyle = useMemo(
    () => ({
      gridTemplateColumns: isPaletteCollapsed
        ? "minmax(0, 1fr)"
        : `minmax(${MIN_CANVAS_BODY_WIDTH_PX}px, 1fr) ${DIVIDER_SIZE_PX}px ${paletteWidth}px`,
    }),
    [isPaletteCollapsed, paletteWidth],
  );

  return (
    <FileDropZone onFile={handleFile}>
      <div className="flex h-screen overflow-hidden flex-col bg-background text-foreground font-sans">
        <header className="flex items-center gap-3 border-b bg-card px-4 py-2.5">
          <span className="font-semibold tracking-tight">NotebookFlow</span>
          <Badge variant="secondary" className="font-mono" title={notebook.name}>
            {isDirty && (
              <span role="img" aria-label="Unsaved changes" className="mr-1 text-foreground">
                ●
              </span>
            )}
            {notebook.name}
          </Badge>
          <Badge variant="outline" className="font-mono">
            {nodeCount} {nodeCount === 1 ? "node" : "nodes"}
          </Badge>
          <EngineStatus client={clientRef.current} />
          <div className="ml-auto flex items-center gap-2">
            {JUPYTER_URL !== "" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  openInJupyterLab(JUPYTER_URL, notebook.name);
                }}
                title={`Open ${notebook.name} in JupyterLab at ${JUPYTER_URL}`}
              >
                <ExternalLink className="mr-1.5 size-3.5" />
                Edit in JupyterLab
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleReingest}>
              <RotateCcw className="mr-1.5 size-3.5" />
              Re-ingest
            </Button>
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
            <select
              value={trigger}
              onChange={(event) => {
                const next = event.target.value;
                if (next === "manual" || next === "scheduled" || next === "file-watch") {
                  setTrigger(next);
                }
              }}
              aria-label="Pipeline trigger"
              title={
                trigger === "manual"
                  ? "Manual trigger: runs only when you press Run"
                  : "Scheduled / file-watch triggers ship with #8 TriggerManager — this stub is UI-only"
              }
              className="h-8 rounded-md border bg-background px-2 text-[11px]"
            >
              <option value="manual">Manual</option>
              <option value="scheduled">Scheduled</option>
              <option value="file-watch">File-watch</option>
            </select>
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
            <Button variant="default" size="sm" onClick={handleRun} disabled={isRunning}>
              <Play className="mr-1.5 size-3.5" />
              {isRunning ? "Running…" : "Run pipeline"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled
              title="Stop arrives with #9 KernelBridge — pipelines currently run synchronously and can't be cancelled mid-flight"
            >
              <Square className="mr-1.5 size-3.5" />
              Stop
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

        {error !== null && (
          <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div ref={contentRef} className="grid min-h-0 flex-1 overflow-hidden" style={contentStyle}>
          <div ref={topPaneRef} className="grid min-h-0 overflow-hidden" style={topPaneStyle}>
            {!isCellsCollapsed && (
              <section className="flex min-h-0 min-w-0 flex-col">
                <div className="flex items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span
                      role="img"
                      aria-label={isDirty ? "Out of sync" : "In sync"}
                      title={
                        isDirty
                          ? "Cells diverge from the loaded .ipynb"
                          : "Cells match the loaded .ipynb"
                      }
                      className={cn(
                        "inline-block size-1.5 rounded-full",
                        isDirty ? "bg-amber-500" : "bg-emerald-500",
                      )}
                    />
                    Cells
                  </span>
                  {selected !== null && (
                    <SelectedNodePill
                      name={selected.name}
                      tag={selected.tag}
                      cellIndices={selected.cellIndices}
                      onClear={() => {
                        setSelected(null);
                      }}
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 px-1.5"
                    title="Collapse cell pane"
                    onClick={() => {
                      setIsCellsCollapsed(true);
                    }}
                  >
                    <PanelLeftClose className="size-3.5" />
                  </Button>
                </div>
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
                <CellPaneFooter cells={notebook.cells} isDirty={isDirty} isRunning={isRunning} />
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
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {filteredPaletteNodes.length === paletteNodes.length
                      ? paletteNodes.length
                      : `${String(filteredPaletteNodes.length)}/${String(paletteNodes.length)}`}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={handleTogglePalette}
                  >
                    {isPaletteCollapsed ? "Show palette" : "Hide palette"}
                  </Button>
                </div>
              </div>
              <div
                ref={canvasPaneRef}
                className="grid min-h-0 flex-1 overflow-hidden bg-background"
                style={canvasPaneStyle}
              >
                <div className="relative min-h-0 flex-1">
                  <Canvas
                    graph={graph}
                    onNodeRename={handleRename}
                    onNodeSelect={setSelected}
                    onInputsChange={handleInputsChange}
                    onOutputsChange={handleOutputsChange}
                    variablesByNode={variablesByNode}
                    runtimeByNode={runtimeByNode}
                    timingByNode={timingByNode}
                    runSummary={runSummary}
                    onPaneDrop={handlePaneDrop}
                  />
                </div>

                {!isPaletteCollapsed && (
                  <PaneDivider
                    orientation="vertical"
                    label="Resize palette and canvas panes"
                    onPointerDown={handlePaletteDividerPointerDown}
                    onKeyDown={handlePaletteDividerKeyDown}
                  />
                )}

                {!isPaletteCollapsed && (
                  <section className="flex min-h-0 min-w-0 flex-col border-l bg-muted/20">
                    <div className="flex items-center gap-2 border-b px-4 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                      Palette
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {filteredPaletteNodes.length === paletteNodes.length
                          ? paletteNodes.length
                          : `${String(filteredPaletteNodes.length)}/${String(paletteNodes.length)}`}
                      </Badge>
                    </div>
                    {paletteNodes.length > 0 && (
                      <div className="flex flex-col gap-2 border-b px-3 py-2">
                        <input
                          type="text"
                          value={paletteSearch}
                          onChange={(event) => {
                            setPaletteSearch(event.target.value);
                          }}
                          placeholder="Search nodes…"
                          aria-label="Search nodes"
                          className="rounded border bg-background px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring"
                        />
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={clearPaletteFilters}
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors",
                              paletteTagFilter.size === 0
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
                                togglePaletteTag(tag);
                              }}
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors",
                                paletteTagFilter.has(tag)
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
                        {paletteError !== null ? (
                          <p className="text-[11px] italic text-muted-foreground">{paletteError}</p>
                        ) : paletteNodes.length === 0 ? (
                          <p className="text-[11px] italic text-muted-foreground">
                            Loading node registry…
                          </p>
                        ) : filteredPaletteNodes.length === 0 ? (
                          <p className="text-[11px] italic text-muted-foreground">
                            No nodes match the current search or filter.
                          </p>
                        ) : (
                          groupPalette(filteredPaletteNodes).map(([tag, nodes]) => (
                            <section key={tag} className="flex flex-col gap-2">
                              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                                {tag}
                              </div>
                              <div className="flex flex-col gap-2">
                                {nodes.map((manifest) => (
                                  <button
                                    key={manifest.id}
                                    type="button"
                                    draggable
                                    onDragStart={(event) => {
                                      event.dataTransfer.setData(NODE_DRAG_MIME, manifest.id);
                                      event.dataTransfer.effectAllowed = "copy";
                                    }}
                                    onClick={() => {
                                      handleAddNode(manifest);
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
                  </section>
                )}
              </div>
            </section>
          </div>

          <PaneDivider
            orientation="horizontal"
            label="Resize editor and inspector panes"
            onPointerDown={handleHorizontalDividerPointerDown}
            onKeyDown={handleHorizontalDividerKeyDown}
          />

          <aside className="min-h-0 grid grid-cols-3 divide-x bg-muted/30 text-xs">
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
          </aside>
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
  isRunning: boolean;
}

function CellPaneFooter({ cells, isDirty, isRunning }: CellPaneFooterProps): ReactElement {
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
            isRunning ? "text-sky-600" : "text-emerald-600",
          )}
          title={
            isRunning
              ? "Engine is executing a pipeline"
              : "Engine is idle; nodes run via exec() against a shared namespace"
          }
        >
          <span
            role="img"
            aria-label={isRunning ? "Executing" : "Idle"}
            className={cn(
              "inline-block size-1.5 rounded-full",
              isRunning ? "animate-pulse bg-sky-500" : "bg-emerald-500",
            )}
          />
          Python 3 · {isRunning ? "executing" : "idle"}
        </span>
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

const TAG_PILL_DOT: Record<NodeModel["tag"], string> = {
  input: "bg-blue-500",
  transform: "bg-emerald-500",
  output: "bg-red-500",
  ai: "bg-purple-500",
  io: "bg-orange-500",
};

interface SelectedNodePillProps {
  name: string;
  tag: NodeModel["tag"];
  cellIndices: number[];
  onClear: () => void;
}

function SelectedNodePill({
  name,
  tag,
  cellIndices,
  onClear,
}: SelectedNodePillProps): ReactElement {
  const range =
    cellIndices.length === 0
      ? null
      : cellIndices.length === 1
        ? `cell ${String(cellIndices[0])}`
        : `cells ${String(cellIndices[0])}–${String(cellIndices[cellIndices.length - 1])}`;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 font-mono text-[10px]">
      <span
        role="img"
        aria-label={`Tag: ${tag}`}
        className={cn("inline-block size-1.5 rounded-full", TAG_PILL_DOT[tag])}
      />
      <span className="font-medium text-foreground">{name}</span>
      {range !== null && <span className="text-muted-foreground">· {range}</span>}
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear node selection"
        className="ml-0.5 rounded text-muted-foreground hover:text-foreground"
      >
        ✕
      </button>
    </span>
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
