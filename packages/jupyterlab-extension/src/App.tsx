/**
 * App — the React surface that lives inside the SplitView Lumino widget.
 *
 * Owns the SyncEngine, listens to the NotebookBridge for cell changes, and
 * renders the shared Canvas with a small run-pipeline control. The Lumino
 * host passes in the bridge and a one-shot ``run`` callback via props so
 * this component stays platform-agnostic.
 */

import type {
  AskAnswer,
  DataFile,
  EngineEvent,
  NbOutput,
  PipelineDef,
  PipelineExplanation,
  PipelineProposal,
} from "@notebookflow/app-core";
import {
  AskPalette,
  buildPipelineDef,
  CellOutputs,
  ComposeDialog,
  ExplanationPanel,
  extractSourceFilename,
  stripMarkerLine,
} from "@notebookflow/app-core";
import type {
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
  deCanvasLabels,
  deNodeConfigLabels,
  hasMissingRequiredConfig,
  NodeConfigEditor,
  readNotebookflowMetadata,
  resolveNodeConfig,
  sanitizeConfigForManifest,
  setPaletteDragData,
  writeNotebookflowMetadata,
} from "@notebookflow/graph-canvas";
import type { CellPatch, NotebookCell } from "@notebookflow/graph-canvas/sync";
import { SyncEngine } from "@notebookflow/graph-canvas/sync";
import type {
  ReactElement,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { NotebookBridge } from "./NotebookBridge";
import {
  deAskPaletteLabels,
  deCellOutputsLabels,
  deComposeDialogLabels,
  deExplanationPanelLabels,
  resolveLocale,
  resolveStrings,
} from "./strings";

export interface AppProps {
  bridge: NotebookBridge;
  onRun: (pipeline: PipelineDef, onEvent: (event: EngineEvent) => void) => Promise<void>;
  onListNodes: () => Promise<NodeManifestDef[]>;
  onSynthesizeNode: (request: {
    manifestId: string;
    nodeName: string;
    inputs: string[];
    outputs: string[];
    config: Record<string, string>;
    currentSource: string;
  }) => Promise<{ source: string; backend: string; warnings: string[] }>;
  onAsk: (prompt: string, pipeline?: PipelineDef) => Promise<AskAnswer>;
  onCompose: (prompt: string) => Promise<PipelineProposal>;
  onExplain: (pipeline: PipelineDef) => Promise<PipelineExplanation>;
  onListDataFiles: () => Promise<DataFile[]>;
  onUploadDataFile: (file: File) => Promise<void>;
  onDeleteDataFile: (name: string) => Promise<void>;
  /**
   * Statically analyze cell sources into per-cell defined-variable names
   * (feeds port autocomplete). Optional: the canvas degrades gracefully when
   * the host has no analyzer (engine offline).
   */
  onAnalyzeCells?: (sources: string[]) => Promise<string[][]>;
  /**
   * Open the optional NotebookFlow Cloud menu (#88: sign in, open/save
   * cloud notebooks). Optional: no button is rendered when the host does
   * not provide it, keeping the surface fully usable signed-out.
   */
  onCloudMenu?: () => void;
}

// JupyterLab's UI language is fixed for the page's lifetime, so resolve the
// string table once at module scope. `undefined` labels keep graph-canvas on
// its English defaults.
const locale = resolveLocale();
const s = resolveStrings();
const canvasLabels = locale === "de" ? deCanvasLabels : undefined;
const nodeConfigLabels = locale === "de" ? deNodeConfigLabels : undefined;
// The app-core AI dialogs fall back to their English defaults when no labels
// are passed, so `undefined` is the correct EN value here too.
const askLabels = locale === "de" ? deAskPaletteLabels : undefined;
const composeLabels = locale === "de" ? deComposeDialogLabels : undefined;
const explanationLabels = locale === "de" ? deExplanationPanelLabels : undefined;
const cellOutputsLabels = locale === "de" ? deCellOutputsLabels : undefined;

const EMPTY_GRAPH: GraphModel = { nodes: {}, groups: {}, wires: {} };
const DIVIDER_SIZE_PX = 10;
const MIN_CANVAS_WIDTH_PX = 280;
const MIN_SIDEBAR_WIDTH_PX = 220;
const DEFAULT_SIDEBAR_WIDTH_PX = 280;
const KEYBOARD_RESIZE_STEP_PX = 24;
const TAG_ORDER = ["input", "transform", "output", "ai", "io"] as const;

interface DragState {
  startCoord: number;
  startWidth: number;
}

export function App({
  bridge,
  onRun,
  onListNodes,
  onSynthesizeNode,
  onAsk,
  onCompose,
  onExplain,
  onListDataFiles,
  onUploadDataFile,
  onDeleteDataFile,
  onAnalyzeCells,
  onCloudMenu,
}: AppProps): ReactElement {
  const [graph, setGraph] = useState<GraphModel>(EMPTY_GRAPH);
  const [cells, setCells] = useState<NotebookCell[]>([]);
  const [selected, setSelected] = useState<NodeModel | null>(null);
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [configDraft, setConfigDraft] = useState<Record<string, string>>({});
  const [configError, setConfigError] = useState<string | null>(null);
  const [configWarnings, setConfigWarnings] = useState<string[]>([]);
  const [configStatus, setConfigStatus] = useState<string | null>(null);
  const [isConfigSubmitting, setIsConfigSubmitting] = useState(false);
  const [paletteNodes, setPaletteNodes] = useState<NodeManifestDef[]>([]);
  const [paletteError, setPaletteError] = useState<string | null>(null);
  const [paletteSearch, setPaletteSearch] = useState("");
  const [paletteTagFilter, setPaletteTagFilter] = useState<ReadonlySet<NodeManifestDef["tag"]>>(
    new Set(),
  );
  const [runtimeByNode, setRuntimeByNode] = useState<Record<string, RuntimeState>>({});
  const [timingByNode, setTimingByNode] = useState<Record<string, number>>({});
  const [rowsByNode, setRowsByNode] = useState<Record<string, number>>({});
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [definedByCell, setDefinedByCell] = useState<string[][]>([]);
  const [showMinimap, setShowMinimap] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH_PX);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
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
  // Per-node nbformat outputs captured from the shared EngineEvent stream, so
  // BOTH the kernel and the engine execution paths feed the sidebar surface.
  const [outputsByNodeId, setOutputsByNodeId] = useState<Record<string, NbOutput[]>>({});
  const [dataFiles, setDataFiles] = useState<DataFile[]>([]);
  const [dataError, setDataError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const lastOpenSidebarWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH_PX);

  const engine = useMemo<SyncEngine>(
    () =>
      new SyncEngine({
        onGraphUpdate: setGraph,
        onCellPatch: (patch: CellPatch): Promise<void> => {
          bridge.applyPatch(patch);
          return Promise.resolve();
        },
      }),
    [bridge],
  );

  useEffect(() => {
    const ingest = (): void => {
      const nextCells = bridge.readCells();
      setCells(nextCells);
      void engine.ingestNotebook(bridge.notebookPath, nextCells, Date.now());
    };
    ingest();
    bridge.changed.connect(ingest);
    return () => {
      bridge.changed.disconnect(ingest);
    };
  }, [bridge, engine]);

  useEffect(() => {
    setSelected((current) => (current === null ? null : (graph.nodes[current.id] ?? null)));
  }, [graph]);

  useEffect(() => {
    let cancelled = false;
    void onListNodes()
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
        setPaletteError(s.couldNotLoadRegistry.replace("{message}", message));
      });
    return () => {
      cancelled = true;
    };
  }, [onListNodes]);

  const handleRename = (nodeId: string, nextName: string): void => {
    void engine.renameNode(nodeId, nextName, Date.now());
  };

  const handleInputsChange = useCallback(
    (nodeId: string, nextInputs: string[]): void => {
      void engine.setNodeInputs(nodeId, nextInputs, Date.now());
    },
    [engine],
  );

  const handleOutputsChange = useCallback(
    (nodeId: string, nextOutputs: string[]): void => {
      void engine.setNodeOutputs(nodeId, nextOutputs, Date.now());
    },
    [engine],
  );

  const handleWireCreate = useCallback(
    (wire: Omit<WireModel, "id">): void => {
      void engine.createWire(
        wire.sourceNodeId,
        wire.sourcePort,
        wire.targetNodeId,
        wire.targetPort,
        Date.now(),
      );
    },
    [engine],
  );

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
      void engine.setNodeInputs(wire.targetNodeId, nextInputs, Date.now());
    },
    [engine, graph],
  );

  const handleAddNode = (
    manifest: NodeManifestDef,
    options?: { insertAtCellIndex?: number },
  ): void => {
    void addManifestNode(engine, onSynthesizeNode, {
      manifest,
      notebookPath: bridge.notebookPath,
      insertAtCellIndex: options?.insertAtCellIndex ?? bridge.readCells().length,
      onSynthesisError: (err: unknown) => {
        const message = err instanceof Error ? err.message : "unknown error";
        setEvents((prev) => [
          ...prev,
          { type: "error", message: s.addNodeFailed.replace("{message}", message) },
        ]);
      },
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "unknown error";
      setEvents((prev) => [
        ...prev,
        { type: "error", message: s.addNodeFailed.replace("{message}", message) },
      ]);
    });
  };

  // Palette drops on the canvas: gap drops carry the notebook group and the
  // preceding cell index, so the new cell lands between nodes; pane drops
  // append at the end. Mirrors the VS Code webview's handlePaneDrop.
  const handlePaneDrop = (
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
      handleAddNode(manifest, { insertAtCellIndex: target.insertAfterCellIndex + 1 });
      return;
    }
    handleAddNode(manifest);
  };

  // Ask the engine to statically analyze cell sources so port autocomplete can
  // suggest real variable names. Debounced and re-run whenever cells change;
  // gracefully empty when the host has no analyzer or the call fails.
  useEffect(() => {
    if (onAnalyzeCells === undefined) {
      setDefinedByCell([]);
      return;
    }
    let cancelled = false;
    const sources = cells.map((cell) => cell.source);
    const timer = window.setTimeout(() => {
      void onAnalyzeCells(sources)
        .then((result) => {
          if (!cancelled) {
            setDefinedByCell(result);
          }
        })
        .catch(() => {
          // Analyzer unavailable — autocomplete just loses the extra names.
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cells, onAnalyzeCells]);

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
      const source = cellIndex === undefined ? undefined : cells[cellIndex]?.source;
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
  }, [graph, cells, rowsByNode]);

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
    if (selected === null || selectedManifest === null) {
      return;
    }

    const nextConfig = sanitizeConfigForManifest(selectedManifest, configDraft);
    const currentSource = stripMarkerLine(
      bridge.readCells()[selected.cellIndices[0] ?? 0]?.source ?? "",
    );
    setConfigError(null);
    setConfigWarnings([]);
    setIsConfigSubmitting(true);

    void onSynthesizeNode({
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
        setConfigError(
          s.couldNotUpdateNode.replace("{name}", selected.name).replace("{message}", message),
        );
      })
      .finally(() => {
        setIsConfigSubmitting(false);
      });
  }, [bridge, configDraft, engine, onSynthesizeNode, selected, selectedManifest]);

  const pushErrorEvent = useCallback((message: string): void => {
    setEvents((prev) => [...prev, { type: "error", message }]);
  }, []);

  const buildCurrentPipeline = useCallback(
    (): PipelineDef =>
      buildPipelineDef(graph, new Map([[bridge.notebookPath, bridge.readCells()]])),
    [bridge, graph],
  );

  // Ask the engine for a prose walkthrough of the current pipeline. Runs
  // through the user's BYOK provider when a key is set (Jupyter settings);
  // template fallback otherwise. Mirrors the web-app's handleExplain.
  const handleExplain = useCallback(async (): Promise<void> => {
    if (isExplaining) {
      return;
    }
    setIsExplaining(true);
    try {
      setExplanation(await onExplain(buildCurrentPipeline()));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      pushErrorEvent(s.explainFailed.replace("{message}", message));
    } finally {
      setIsExplaining(false);
    }
  }, [buildCurrentPipeline, isExplaining, onExplain, pushErrorEvent]);

  const handleCompose = useCallback(async (): Promise<void> => {
    if (composePrompt.trim() === "") {
      setComposeError(s.composeEmpty);
      return;
    }
    setIsComposing(true);
    setComposeError(null);
    try {
      setComposeResult(await onCompose(composePrompt.trim()));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      setComposeError(s.composeFailed.replace("{message}", message));
    } finally {
      setIsComposing(false);
    }
  }, [composePrompt, onCompose]);

  const handleAsk = useCallback(async (): Promise<void> => {
    if (askPrompt.trim() === "") {
      setAskError(s.askEmpty);
      return;
    }
    setIsAsking(true);
    setAskError(null);
    try {
      // Pass the current pipeline as context so the answer can reference
      // specific node names; omit it when the canvas is empty — the engine
      // treats absent pipelines as a general Q&A.
      const pipeline = buildCurrentPipeline();
      setAskResult(await onAsk(askPrompt.trim(), pipeline.nodes.length > 0 ? pipeline : undefined));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      setAskError(s.askFailed.replace("{message}", message));
    } finally {
      setIsAsking(false);
    }
  }, [askPrompt, buildCurrentPipeline, onAsk]);

  // Replace the notebook with the drafted cells through the NotebookBridge's
  // patch surface: delete every current cell (highest index first so indices
  // stay valid), then insert the drafted cells in order. Every mutation fires
  // the bridge's `changed` signal, so the SyncEngine re-ingests and the graph
  // converges on its own.
  const handleApplyProposal = useCallback((): void => {
    if (composeResult === null || composeResult.cellSources.length === 0) {
      return;
    }
    const notebookPath = bridge.notebookPath;
    try {
      for (let cellIndex = bridge.readCells().length - 1; cellIndex >= 0; cellIndex -= 1) {
        bridge.applyPatch({ notebookPath, cellIndex, operation: "delete", newSource: null });
      }
      composeResult.cellSources.forEach((source, cellIndex) => {
        bridge.applyPatch({
          notebookPath,
          cellIndex,
          operation: "insert",
          newSource: source,
          cellType: "code",
        });
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      pushErrorEvent(s.applyProposalFailed.replace("{message}", message));
      return;
    }
    setSelected(null);
    setEvents([]);
    setExplanation(null);
    setIsComposeOpen(false);
    setComposeResult(null);
    setComposePrompt("");
    setComposeError(null);
  }, [bridge, composeResult, pushErrorEvent]);

  // Data files a pipeline reads by name (`pd.read_csv("orders.csv")`). The
  // host decides the storage target per call: the notebook's directory via
  // the Jupyter Contents API when a kernel is attached (kernel cwd), the
  // engine's data dir otherwise.
  const refreshDataFiles = useCallback(async (): Promise<void> => {
    try {
      setDataFiles(await onListDataFiles());
      setDataError(null);
    } catch (err: unknown) {
      // Neither surface reachable (engine offline / contents error) — degrade
      // to an empty list with a muted note instead of crashing the sidebar.
      const message = err instanceof Error ? err.message : "unknown error";
      setDataFiles([]);
      setDataError(s.dataUnavailable.replace("{message}", message));
    }
  }, [onListDataFiles]);

  useEffect(() => {
    void refreshDataFiles();
  }, [refreshDataFiles]);

  const triggerUploadData = useCallback((): void => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.tsv,.json,.parquet,.txt,.xlsx";
    input.onchange = (): void => {
      const file = input.files?.[0];
      if (file === undefined) {
        return;
      }
      void onUploadDataFile(file)
        .then(() => refreshDataFiles())
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "unknown error";
          pushErrorEvent(s.uploadDataFailed.replace("{message}", message));
        });
    };
    input.click();
  }, [onUploadDataFile, pushErrorEvent, refreshDataFiles]);

  const handleDeleteData = useCallback(
    (name: string): void => {
      void onDeleteDataFile(name)
        .then(() => refreshDataFiles())
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "unknown error";
          pushErrorEvent(s.deleteDataFailed.replace("{message}", message));
        });
    },
    [onDeleteDataFile, pushErrorEvent, refreshDataFiles],
  );

  // Cmd/Ctrl+K toggles the Ask AI palette; bare M toggles the minimap
  // (suppressed while typing so it doesn't hijack editing), mirroring the
  // web app + VS Code.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        setIsAskOpen((open) => !open);
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        setShowMinimap((on) => !on);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const handleRun = (): void => {
    if (isRunning) {
      return;
    }
    const pipeline = buildCurrentPipeline();
    const outputCellIndices = Array.from(
      new Set(
        pipeline.nodes
          .flatMap((node) => node.cellIndices)
          .filter((cellIndex) => Number.isInteger(cellIndex) && cellIndex >= 0),
      ),
    );
    setEvents([]);
    setIsRunning(true);
    setOutputsByNodeId({});
    setTimingByNode({});
    setRowsByNode({});
    setRunSummary(null);
    const initialRuntime: Record<string, RuntimeState> = {};
    for (const nodeId of Object.keys(graph.nodes)) {
      initialRuntime[nodeId] = "queued";
    }
    setRuntimeByNode(initialRuntime);
    bridge.clearOutputs(outputCellIndices);
    let nextExecutionCount = 0;
    void onRun(pipeline, (event) => {
      setEvents((prev) => [...prev, event]);
      if (event.type === "nodeStarted") {
        setRuntimeByNode((prev) => ({ ...prev, [event.nodeId]: "running" }));
        return;
      }
      if (event.type === "pipelineCompleted") {
        setRunSummary({
          totalNodes: event.results.length,
          ok: event.results.filter((r) => r.status === "ok").length,
          error: event.results.filter((r) => r.status === "error").length,
          skipped: event.results.filter((r) => r.status === "skipped").length,
          totalDurationMs: event.results.reduce((sum, r) => sum + r.durationMs, 0),
        });
        return;
      }
      if (event.type !== "nodeCompleted") {
        return;
      }
      const status = event.result.status;
      if (status === "ok" || status === "error" || status === "skipped") {
        setRuntimeByNode((prev) => ({ ...prev, [event.result.nodeId]: status }));
      }
      setTimingByNode((prev) => ({ ...prev, [event.result.nodeId]: event.result.durationMs }));
      const rows = event.result.metadata?.rows;
      if (rows !== undefined) {
        setRowsByNode((prev) => ({ ...prev, [event.result.nodeId]: rows }));
      }
      setOutputsByNodeId((prev) => ({ ...prev, [event.result.nodeId]: event.result.outputs }));
      const cellIndex = graph.nodes[event.result.nodeId]?.cellIndices[0];
      if (cellIndex === undefined) {
        return;
      }
      const executionCount = event.result.status === "skipped" ? null : ++nextExecutionCount;
      try {
        bridge.replaceOutputs(cellIndex, event.result.outputs, executionCount);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "unknown error";
        setEvents((prev) => [
          ...prev,
          { type: "error", message: s.outputUpdateFailed.replace("{message}", message) },
        ]);
      }
    })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "unknown error";
        setEvents((prev) => [...prev, { type: "error", message }]);
      })
      .finally(() => {
        setIsRunning(false);
      });
  };

  const clampSidebarWidth = useCallback((value: number): number => {
    const host = bodyRef.current;
    if (host === null) {
      return Math.max(MIN_SIDEBAR_WIDTH_PX, value);
    }
    const maxWidth = Math.max(
      host.clientWidth - MIN_CANVAS_WIDTH_PX - DIVIDER_SIZE_PX,
      MIN_SIDEBAR_WIDTH_PX,
    );
    return clamp(value, MIN_SIDEBAR_WIDTH_PX, maxWidth);
  }, []);

  const collapseSidebar = useCallback((): void => {
    lastOpenSidebarWidthRef.current = sidebarWidth;
    setIsSidebarCollapsed(true);
    setDragState(null);
  }, [sidebarWidth]);

  const openSidebar = useCallback((): void => {
    setSidebarWidth(clampSidebarWidth(lastOpenSidebarWidthRef.current));
    setIsSidebarCollapsed(false);
  }, [clampSidebarWidth]);

  const toggleSidebar = useCallback((): void => {
    if (isSidebarCollapsed) {
      openSidebar();
      return;
    }
    collapseSidebar();
  }, [collapseSidebar, isSidebarCollapsed, openSidebar]);

  useEffect(() => {
    if (selected !== null) {
      openSidebar();
    }
  }, [selected, openSidebar]);

  useEffect(() => {
    if (!isSidebarCollapsed) {
      lastOpenSidebarWidthRef.current = sidebarWidth;
    }
  }, [isSidebarCollapsed, sidebarWidth]);

  useEffect(() => {
    if (dragState === null) {
      return;
    }

    const handlePointerMove = (event: PointerEvent): void => {
      const nextWidth = dragState.startWidth - (event.clientX - dragState.startCoord);
      setSidebarWidth(clampSidebarWidth(nextWidth));
    };

    const handlePointerUp = (): void => {
      setDragState(null);
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
  }, [clampSidebarWidth, dragState]);

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
      setDragState({ startCoord: event.clientX, startWidth: sidebarWidth });
    },
    [sidebarWidth],
  );

  const handleSidebarDividerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setSidebarWidth((current) => clampSidebarWidth(current + KEYBOARD_RESIZE_STEP_PX));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setSidebarWidth((current) => clampSidebarWidth(current - KEYBOARD_RESIZE_STEP_PX));
      } else if (event.key === "Home") {
        event.preventDefault();
        collapseSidebar();
      } else if (event.key === "End") {
        event.preventDefault();
        setSidebarWidth(() => clampSidebarWidth(Number.MAX_SAFE_INTEGER));
      }
    },
    [clampSidebarWidth, collapseSidebar],
  );

  const bodyLayoutStyle = useMemo(
    () => ({
      ...bodyStyle,
      gridTemplateColumns: isSidebarCollapsed
        ? "minmax(0, 1fr)"
        : `minmax(${MIN_CANVAS_WIDTH_PX}px, 1fr) ${DIVIDER_SIZE_PX}px ${sidebarWidth}px`,
    }),
    [isSidebarCollapsed, sidebarWidth],
  );

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <span style={{ fontWeight: 600 }}>NotebookFlow</span>
        <span style={{ opacity: 0.65, fontSize: 11 }}>
          {s.nodeCountPath
            .replace("{count}", String(Object.keys(graph.nodes).length))
            .replace("{path}", bridge.notebookPath)}
        </span>
        <div style={headerActionsStyle}>
          {onCloudMenu !== undefined && (
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={onCloudMenu}
              title={s.cloudTitle}
            >
              {s.cloud}
            </button>
          )}
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={() => {
              void handleExplain();
            }}
            disabled={isExplaining}
            title={s.explainTitle}
          >
            {isExplaining ? s.explaining : s.explain}
          </button>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={() => {
              setIsComposeOpen(true);
            }}
            title={s.composeTitle}
          >
            {s.compose}
          </button>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={() => {
              setIsAskOpen(true);
            }}
            title={s.askAiTitle}
          >
            {s.askAi}
          </button>
          <button type="button" style={secondaryButtonStyle} onClick={toggleSidebar}>
            {isSidebarCollapsed ? s.showSidebar : s.hideSidebar}
          </button>
          <button type="button" style={buttonStyle} onClick={handleRun} disabled={isRunning}>
            {isRunning ? s.running : s.runPipeline}
          </button>
        </div>
      </header>
      {explanation !== null && (
        <ExplanationPanel
          explanation={explanation}
          onClose={() => {
            setExplanation(null);
          }}
          {...(explanationLabels === undefined ? {} : { labels: explanationLabels })}
        />
      )}
      <div ref={bodyRef} style={bodyLayoutStyle}>
        <main style={canvasStyle}>
          <Canvas
            graph={graph}
            selectedNodeId={selected?.id ?? null}
            activeGroupId={bridge.notebookPath}
            onNodeRename={handleRename}
            onNodeSelect={setSelected}
            onInputsChange={handleInputsChange}
            onOutputsChange={handleOutputsChange}
            onWireCreate={handleWireCreate}
            onWireDelete={handleWireDelete}
            onPaneDrop={handlePaneDrop}
            variablesByNode={variablesByNode}
            runtimeByNode={runtimeByNode}
            timingByNode={timingByNode}
            metaByNode={metaByNode}
            unresolvedByNode={unresolvedByNode}
            runSummary={runSummary}
            showMinimap={showMinimap}
            onToggleMinimap={() => {
              setShowMinimap((on) => !on);
            }}
            {...(canvasLabels === undefined ? {} : { labels: canvasLabels })}
          />
        </main>

        {!isSidebarCollapsed && (
          <button
            type="button"
            aria-label={s.resizeSidebarAria}
            style={dividerStyle}
            onPointerDown={handleSidebarDividerPointerDown}
            onKeyDown={handleSidebarDividerKeyDown}
          >
            <span style={dividerHandleStyle} />
          </button>
        )}

        {!isSidebarCollapsed && (
          <aside style={sidebarStyle}>
            <div style={sidebarSelectedSectionStyle}>
              <h3 style={sectionTitleStyle}>{s.selectedHeading}</h3>
              {selected === null ? (
                <p style={mutedStyle}>{s.clickNode}</p>
              ) : selectedManifest !== null && selectedManifest.configFields.length > 0 ? (
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
                  {...(nodeConfigLabels === undefined ? {} : { labels: nodeConfigLabels })}
                />
              ) : (
                <pre style={preStyle}>{JSON.stringify(selected, null, 2)}</pre>
              )}
              {selected !== null && (outputsByNodeId[selected.id] ?? []).length > 0 && (
                <>
                  <h3 style={sectionTitleStyle}>{s.outputsHeading}</h3>
                  <CellOutputs
                    outputs={outputsByNodeId[selected.id] ?? []}
                    {...(cellOutputsLabels === undefined ? {} : { labels: cellOutputsLabels })}
                  />
                </>
              )}
            </div>
            <div style={sidebarScrollSectionStyle}>
              <div style={sidebarSectionHeaderStyle}>
                <h3 style={sectionTitleResetStyle}>{s.paletteHeading}</h3>
                <span style={countBadgeStyle}>{paletteNodes.length}</span>
              </div>
              {paletteNodes.length > 0 && (
                <div style={paletteFilterBarStyle}>
                  <input
                    type="text"
                    value={paletteSearch}
                    onChange={(event) => {
                      setPaletteSearch(event.target.value);
                    }}
                    placeholder={s.paletteSearchPlaceholder}
                    aria-label={s.paletteSearchLabel}
                    style={paletteSearchInputStyle}
                  />
                  <div style={paletteTagRowStyle}>
                    <button
                      type="button"
                      onClick={clearPaletteFilters}
                      style={
                        paletteTagFilter.size === 0
                          ? paletteTagPillActiveStyle
                          : paletteTagPillStyle
                      }
                    >
                      {s.paletteAll}
                    </button>
                    {TAG_ORDER.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => {
                          togglePaletteTag(tag);
                        }}
                        style={
                          paletteTagFilter.has(tag)
                            ? paletteTagPillActiveStyle
                            : paletteTagPillStyle
                        }
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {paletteError !== null ? (
                <p style={mutedStyle}>{paletteError}</p>
              ) : paletteNodes.length === 0 ? (
                <p style={mutedStyle}>{s.loadingRegistry}</p>
              ) : filteredPaletteNodes.length === 0 ? (
                <p style={mutedStyle}>{s.paletteNoMatches}</p>
              ) : (
                <div style={paletteStyle}>
                  {groupPalette(filteredPaletteNodes).map(([tag, nodes]) => (
                    <section key={tag}>
                      <div style={paletteGroupTitleStyle}>{tag}</div>
                      <div style={paletteGroupListStyle}>
                        {nodes.map((manifest) => (
                          <button
                            key={manifest.id}
                            type="button"
                            style={paletteItemStyle}
                            draggable
                            onDragStart={(event) => {
                              setPaletteDragData(event.dataTransfer, manifest.id);
                            }}
                            onClick={() => {
                              handleAddNode(manifest);
                            }}
                            title={s.appendOrDrag}
                          >
                            <div style={paletteItemHeaderStyle}>
                              <span style={{ fontWeight: 600 }}>{manifest.name}</span>
                              <span style={tagBadgeStyle}>{manifest.tag}</span>
                            </div>
                            <div style={paletteItemMetaStyle}>{manifest.id}</div>
                            {manifest.description !== "" && (
                              <div style={paletteItemDescriptionStyle}>{manifest.description}</div>
                            )}
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
              <div style={{ ...sidebarSectionHeaderStyle, marginTop: 12 }}>
                <h3 style={sectionTitleResetStyle}>{s.dataHeading}</h3>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={triggerUploadData}
                  title={s.uploadData}
                  aria-label={s.uploadData}
                >
                  {s.upload}
                </button>
              </div>
              {dataError !== null ? (
                <p style={mutedStyle}>{dataError}</p>
              ) : dataFiles.length === 0 ? (
                <p style={mutedStyle}>{s.dataEmpty}</p>
              ) : (
                <ul style={eventListStyle}>
                  {dataFiles.map((file) => (
                    <li key={file.name} style={dataItemStyle}>
                      <span style={dataNameStyle} title={file.name}>
                        {file.name}
                      </span>
                      <span style={dataSizeStyle}>{formatBytes(file.size)}</span>
                      <button
                        type="button"
                        style={dataDeleteButtonStyle}
                        onClick={() => {
                          handleDeleteData(file.name);
                        }}
                        title={s.deleteDataFile.replace("{name}", file.name)}
                        aria-label={s.deleteDataFile.replace("{name}", file.name)}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <h3 style={sectionTitleStyle}>
                {s.executionEvents.replace("{count}", String(events.length))}
              </h3>
              {events.length === 0 ? (
                <p style={mutedStyle}>{s.clickRunToDispatch}</p>
              ) : (
                <ul style={eventListStyle}>
                  {events.map((event, idx) => (
                    <li key={`${event.type}-${String(idx)}`} style={eventItemStyle}>
                      {renderEvent(event)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        )}
      </div>

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
          {...(composeLabels === undefined ? {} : { labels: composeLabels })}
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
          {...(askLabels === undefined ? {} : { labels: askLabels })}
        />
      )}
    </div>
  );
}

function buildGenerationStatus(metadata: {
  lastGeneratedAt?: string;
  lastGenerationBackend?: string;
}): string | null {
  if (metadata.lastGenerationBackend === undefined && metadata.lastGeneratedAt === undefined) {
    return null;
  }
  const backend = metadata.lastGenerationBackend ?? "template";
  if (metadata.lastGeneratedAt === undefined) {
    return s.generatedVia.replace("{backend}", backend);
  }
  const when = new Date(metadata.lastGeneratedAt).toLocaleString();
  return s.generatedViaAt.replace("{backend}", backend).replace("{when}", when);
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

const containerStyle = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  fontFamily: "var(--jp-ui-font-family, system-ui, sans-serif)",
  background: "var(--jp-layout-color1, #ffffff)",
  color: "var(--jp-ui-font-color1, #111827)",
} as const;

const headerStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "6px 10px",
  borderBottom: "1px solid var(--jp-border-color2, #d1d5db)",
  background: "var(--jp-layout-color2, #f3f4f6)",
  fontSize: 12,
} as const;

const headerActionsStyle = {
  marginLeft: "auto",
  display: "flex",
  alignItems: "center",
  gap: 8,
} as const;

const buttonStyle = {
  border: "1px solid var(--jp-border-color1, #9ca3af)",
  background: "var(--jp-brand-color1, #2563eb)",
  color: "#ffffff",
  borderRadius: 3,
  padding: "3px 10px",
  cursor: "pointer",
  fontSize: 11,
} as const;

const secondaryButtonStyle = {
  border: "1px solid var(--jp-border-color2, #d1d5db)",
  background: "var(--jp-layout-color1, #ffffff)",
  color: "var(--jp-ui-font-color1, #111827)",
  borderRadius: 3,
  padding: "3px 10px",
  cursor: "pointer",
  fontSize: 11,
} as const;

const bodyStyle = { display: "grid", flex: 1, minHeight: 0 } as const;

const canvasStyle = { position: "relative", minWidth: 0 } as const;

const sidebarStyle = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0,
  fontSize: 11,
  background: "var(--jp-layout-color1, #ffffff)",
  borderLeft: "1px solid var(--jp-border-color2, #d1d5db)",
} as const;

const sidebarSelectedSectionStyle = {
  flexShrink: 0,
  maxHeight: "42%",
  minHeight: 112,
  overflow: "auto",
  padding: 10,
  borderBottom: "1px solid var(--jp-border-color2, #d1d5db)",
} as const;

const sidebarScrollSectionStyle = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  padding: 10,
} as const;

const dividerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: DIVIDER_SIZE_PX,
  padding: 0,
  border: 0,
  background: "var(--jp-layout-color2, #f3f4f6)",
  cursor: "col-resize",
} as const;

const dividerHandleStyle = {
  width: 4,
  height: 52,
  borderRadius: 999,
  background: "var(--jp-border-color1, #9ca3af)",
} as const;

const sidebarSectionHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginBottom: 6,
} as const;

const sectionTitleResetStyle = {
  margin: 0,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "var(--jp-ui-font-color2, #6b7280)",
} as const;

const countBadgeStyle = {
  fontSize: 10,
  fontFamily: "var(--jp-code-font-family, monospace)",
  padding: "1px 6px",
  borderRadius: 999,
  border: "1px solid var(--jp-border-color2, #d1d5db)",
  color: "var(--jp-ui-font-color2, #6b7280)",
} as const;

const sectionTitleStyle = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "var(--jp-ui-font-color2, #6b7280)",
  marginTop: 12,
  marginBottom: 4,
} as const;

const mutedStyle = {
  color: "var(--jp-ui-font-color3, #9ca3af)",
  fontStyle: "italic",
} as const;

const preStyle = {
  fontSize: 10,
  whiteSpace: "pre-wrap",
  background: "var(--jp-layout-color0, #f9fafb)",
  border: "1px solid var(--jp-border-color2, #d1d5db)",
  borderRadius: 3,
  padding: 6,
  margin: 0,
} as const;

const eventListStyle = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 3,
} as const;

const eventItemStyle = {
  background: "var(--jp-layout-color0, #f9fafb)",
  border: "1px solid var(--jp-border-color2, #d1d5db)",
  borderRadius: 3,
  padding: "4px 6px",
  fontFamily: "var(--jp-code-font-family, monospace)",
  fontSize: 10,
} as const;

const paletteStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
} as const;

const paletteFilterBarStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginBottom: 8,
  paddingBottom: 8,
  borderBottom: "1px solid var(--jp-border-color2, #d1d5db)",
} as const;

const paletteSearchInputStyle = {
  border: "1px solid var(--jp-border-color2, #d1d5db)",
  background: "var(--jp-layout-color0, #f9fafb)",
  color: "var(--jp-ui-font-color1, #111827)",
  borderRadius: 3,
  padding: "3px 6px",
  fontSize: 11,
  outline: "none",
} as const;

const paletteTagRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
} as const;

const paletteTagPillStyle = {
  fontSize: 9,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  padding: "1px 8px",
  borderRadius: 999,
  border: "1px solid var(--jp-border-color2, #d1d5db)",
  background: "var(--jp-layout-color0, #f9fafb)",
  color: "var(--jp-ui-font-color2, #6b7280)",
  cursor: "pointer",
} as const;

const paletteTagPillActiveStyle = {
  ...paletteTagPillStyle,
  border: "1px solid var(--jp-ui-font-color1, #111827)",
  background: "var(--jp-ui-font-color1, #111827)",
  color: "var(--jp-layout-color1, #ffffff)",
} as const;

const paletteGroupTitleStyle = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "var(--jp-ui-font-color2, #6b7280)",
  marginBottom: 4,
} as const;

const paletteGroupListStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
} as const;

const paletteItemStyle = {
  width: "100%",
  textAlign: "left",
  border: "1px solid var(--jp-border-color2, #d1d5db)",
  background: "var(--jp-layout-color0, #f9fafb)",
  borderRadius: 4,
  padding: "6px 8px",
  cursor: "pointer",
} as const;

const paletteItemHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
} as const;

const tagBadgeStyle = {
  fontSize: 9,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  padding: "1px 4px",
  borderRadius: 999,
  border: "1px solid var(--jp-border-color2, #d1d5db)",
} as const;

const paletteItemMetaStyle = {
  marginTop: 2,
  fontSize: 10,
  color: "var(--jp-ui-font-color3, #9ca3af)",
  fontFamily: "var(--jp-code-font-family, monospace)",
} as const;

const paletteItemDescriptionStyle = {
  marginTop: 4,
  color: "var(--jp-ui-font-color2, #6b7280)",
  lineHeight: 1.35,
} as const;

const dataItemStyle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  background: "var(--jp-layout-color0, #f9fafb)",
  border: "1px solid var(--jp-border-color2, #d1d5db)",
  borderRadius: 3,
  padding: "4px 6px",
  fontSize: 10,
} as const;

const dataNameStyle = {
  minWidth: 0,
  flex: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontFamily: "var(--jp-code-font-family, monospace)",
} as const;

const dataSizeStyle = {
  flexShrink: 0,
  fontFamily: "var(--jp-code-font-family, monospace)",
  color: "var(--jp-ui-font-color3, #9ca3af)",
} as const;

const dataDeleteButtonStyle = {
  flexShrink: 0,
  border: 0,
  background: "transparent",
  color: "var(--jp-ui-font-color2, #6b7280)",
  cursor: "pointer",
  padding: 2,
  fontSize: 10,
  lineHeight: 1,
} as const;

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
