/**
 * VS Code webview app — hosts the shared Canvas and bridges to:
 *   - the extension host via postMessage (cell ingest, patch outbound)
 *   - the FastAPI engine via WebSocket (run pipeline, stream events)
 *
 * The extension host posts:
 *   { type: "ingest", path, cells, timestamp } — every notebook change
 *   { type: "engineUrl", url } — once the engine subprocess is healthy
 *   { type: "engineDown" } — engine stopped / failed
 *
 * This app posts back:
 *   { type: "patch", cellIndex, operation, newSource, cellType?, metadata? }
 *     — every SyncEngine cell patch
 *   { type: "clearOutputs", cellIndices } — clear notebook outputs before run
 *   { type: "replaceOutputs", cellIndex, outputs, status, durationMs }
 */

import type {
  AskAnswer,
  Credentials,
  DataFile,
  EngineEvent,
  PipelineExplanation,
  PipelineProposal,
} from "@notebookflow/app-core";
import {
  AskPalette,
  buildPipelineDef,
  ComposeDialog,
  EngineClient,
  ExplanationPanel,
  extractSourceFilename,
  renderEvent,
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
import { Command, Database, Sparkles, Upload, Wand2, X } from "lucide-react";
import type {
  ReactElement,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deAskPaletteLabels,
  deComposeDialogLabels,
  deExplanationPanelLabels,
  resolveLocale,
  resolveStrings,
} from "./strings";

declare global {
  interface VsCodeApi {
    postMessage(msg: unknown): void;
    setState(state: unknown): void;
    getState(): unknown;
  }
  function acquireVsCodeApi(): VsCodeApi;
}

const vscode = acquireVsCodeApi();

// The webview's locale is fixed for its whole lifetime (VS Code injects it into
// the HTML), so resolve the string table once at module scope. `undefined`
// labels keep graph-canvas on its English defaults.
const locale = resolveLocale();
const s = resolveStrings();
const canvasLabels = locale === "de" ? deCanvasLabels : undefined;
const nodeConfigLabels = locale === "de" ? deNodeConfigLabels : undefined;
// The app-core AI dialogs fall back to their English defaults when no labels
// are passed, so `undefined` is the correct EN value here too.
const askLabels = locale === "de" ? deAskPaletteLabels : undefined;
const composeLabels = locale === "de" ? deComposeDialogLabels : undefined;
const explanationLabels = locale === "de" ? deExplanationPanelLabels : undefined;

interface IngestMessage {
  type: "ingest";
  path: string;
  cells: NotebookCell[];
  timestamp: number;
}

interface EngineUrlMessage {
  type: "engineUrl";
  url: string;
}

interface EngineDownMessage {
  type: "engineDown";
  reason?: string;
}

interface CredentialsMessage {
  type: "credentials";
  provider: string;
  model: string;
  apiKey: string;
}

type HostMessage = IngestMessage | EngineUrlMessage | EngineDownMessage | CredentialsMessage;

const EMPTY_GRAPH: GraphModel = { nodes: {}, groups: {}, wires: {} };
const DIVIDER_SIZE_PX = 10;
const MIN_CANVAS_WIDTH_PX = 320;
const MIN_SIDEBAR_WIDTH_PX = 240;
const DEFAULT_SIDEBAR_WIDTH_PX = 280;
const KEYBOARD_RESIZE_STEP_PX = 24;
const TAG_ORDER = ["input", "transform", "output", "ai", "io"] as const;

interface DragState {
  startCoord: number;
  startWidth: number;
}

export function App(): ReactElement {
  const [graph, setGraph] = useState<GraphModel>(EMPTY_GRAPH);
  const [cells, setCells] = useState<NotebookCell[]>([]);
  const [notebookPath, setNotebookPath] = useState("");
  const [engineUrl, setEngineUrl] = useState<string | null>(null);
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [selected, setSelected] = useState<NodeModel | null>(null);
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
  const [dataFiles, setDataFiles] = useState<DataFile[]>([]);
  const engineRef = useRef<SyncEngine | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const lastOpenSidebarWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH_PX);
  // Engine REST client (app-core). Recreated when the engine URL changes; the
  // latest BYOK credentials live in a ref so a fresh client never loses them.
  const clientRef = useRef<EngineClient | null>(null);
  const credentialsRef = useRef<Credentials | null>(null);

  useEffect(() => {
    const engine = new SyncEngine({
      onGraphUpdate: setGraph,
      onCellPatch: (patch: CellPatch): Promise<void> => {
        vscode.postMessage({
          type: "patch",
          cellIndex: patch.cellIndex,
          operation: patch.operation,
          newSource: patch.newSource,
          cellType: patch.cellType,
          metadata: patch.metadata,
        });
        return Promise.resolve();
      },
    });
    engineRef.current = engine;

    const handler = (event: MessageEvent<HostMessage>): void => {
      const msg = event.data;
      if (msg.type === "ingest") {
        setCells(msg.cells);
        setNotebookPath(msg.path);
        void engine.ingestNotebook(msg.path, msg.cells, msg.timestamp);
      } else if (msg.type === "engineUrl") {
        // EngineClient expects the WS endpoint and derives REST URLs from it.
        // Token "" — the local engine subprocess is trusted (loopback only).
        const client = new EngineClient(`${msg.url.replace(/^http/, "ws")}/ws`);
        client.setCredentials(credentialsRef.current);
        clientRef.current = client;
        setEngineUrl(msg.url);
      } else if (msg.type === "engineDown") {
        clientRef.current = null;
        setEngineUrl(null);
      } else if (msg.type === "credentials") {
        // BYOK credentials from the extension host (settings + SecretStorage).
        // An empty key clears them so the engine falls back to its env key.
        const credentials =
          msg.apiKey.trim() === ""
            ? null
            : { provider: msg.provider, model: msg.model, apiKey: msg.apiKey };
        credentialsRef.current = credentials;
        clientRef.current?.setCredentials(credentials);
      }
    };
    window.addEventListener("message", handler);
    // Signal to the host that our listener is attached. The host waits for
    // this before posting ingest / engineUrl, otherwise those messages race
    // ahead of React's first render and get dropped on the floor.
    vscode.postMessage({ type: "webviewReady" });
    return () => {
      window.removeEventListener("message", handler);
    };
  }, []);

  useEffect(() => {
    setSelected((current) => (current === null ? null : (graph.nodes[current.id] ?? null)));
  }, [graph]);

  const handleRename = (nodeId: string, nextName: string): void => {
    void engineRef.current?.renameNode(nodeId, nextName, Date.now());
  };

  const handleInputsChange = useCallback((nodeId: string, nextInputs: string[]): void => {
    void engineRef.current?.setNodeInputs(nodeId, nextInputs, Date.now());
  }, []);

  const handleOutputsChange = useCallback((nodeId: string, nextOutputs: string[]): void => {
    void engineRef.current?.setNodeOutputs(nodeId, nextOutputs, Date.now());
  }, []);

  const handleWireCreate = useCallback((wire: Omit<WireModel, "id">): void => {
    void engineRef.current?.createWire(
      wire.sourceNodeId,
      wire.sourcePort,
      wire.targetNodeId,
      wire.targetPort,
      Date.now(),
    );
  }, []);

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
    (manifest: NodeManifestDef, options?: { insertAtCellIndex?: number }): void => {
      const engine = engineRef.current;
      const client = clientRef.current;
      if (notebookPath === "" || engineUrl === null || engine === null || client === null) {
        setEvents((prev) => [
          ...prev,
          {
            type: "error",
            message: s.startEngineBeforePalette,
          },
        ]);
        return;
      }
      const insertAtCellIndex = options?.insertAtCellIndex ?? cells.length;
      void addManifestNode(engine, (request) => client.synthesizeNode(request), {
        manifest,
        notebookPath,
        insertAtCellIndex,
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
    },
    [cells.length, engineUrl, notebookPath],
  );

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
        handleAddNode(manifest, { insertAtCellIndex: target.insertAfterCellIndex + 1 });
        return;
      }
      handleAddNode(manifest);
    },
    [paletteNodes, handleAddNode],
  );

  useEffect(() => {
    const client = clientRef.current;
    if (engineUrl === null || client === null) {
      setPaletteNodes([]);
      setPaletteError(s.startEngineToLoadPalette);
      return;
    }

    let cancelled = false;
    void client
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
        setPaletteError(s.couldNotLoadRegistry.replace("{message}", message));
      });

    return () => {
      cancelled = true;
    };
  }, [engineUrl]);

  // Ask the engine to statically analyze cell sources so port autocomplete can
  // suggest real variable names. Debounced and re-run whenever cells change.
  // Mirrors the web-app's analyze effect; empty when the engine is offline.
  useEffect(() => {
    const client = clientRef.current;
    if (engineUrl === null || client === null) {
      setDefinedByCell([]);
      return;
    }
    let cancelled = false;
    const sources = cells.map((cell) => cell.source);
    const timer = window.setTimeout(() => {
      void client
        .analyzeCells(sources)
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
  }, [cells, engineUrl]);

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
    const engine = engineRef.current;
    const client = clientRef.current;
    if (
      engine === null ||
      client === null ||
      engineUrl === null ||
      selected === null ||
      selectedManifest === null
    ) {
      return;
    }

    const nextConfig = sanitizeConfigForManifest(selectedManifest, configDraft);
    const currentSource = stripMarkerLine(cells[selected.cellIndices[0] ?? 0]?.source ?? "");
    setConfigError(null);
    setConfigWarnings([]);
    setIsConfigSubmitting(true);

    void client
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
        setConfigError(
          s.couldNotUpdateNode.replace("{name}", selected.name).replace("{message}", message),
        );
      })
      .finally(() => {
        setIsConfigSubmitting(false);
      });
  }, [cells, configDraft, engineUrl, selected, selectedManifest]);

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

  const pipelineDef = useMemo(
    () => buildPipelineDef(graph, new Map([[notebookPath, cells]])),
    [graph, cells, notebookPath],
  );

  const pushErrorEvent = useCallback((message: string): void => {
    setEvents((prev) => [...prev, { type: "error", message }]);
  }, []);

  // Ask the engine for a prose walkthrough of the current pipeline. Runs
  // through the user's BYOK provider when a key is set; template fallback
  // otherwise. Mirrors the web-app's handleExplain.
  const handleExplain = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (isExplaining) {
      return;
    }
    if (client === null) {
      pushErrorEvent(s.startEngineToUseAi);
      return;
    }
    setIsExplaining(true);
    try {
      setExplanation(await client.explainPipeline(pipelineDef));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      pushErrorEvent(s.explainFailed.replace("{message}", message));
    } finally {
      setIsExplaining(false);
    }
  }, [isExplaining, pipelineDef, pushErrorEvent]);

  const handleCompose = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (composePrompt.trim() === "") {
      setComposeError(s.composeEmpty);
      return;
    }
    if (client === null) {
      setComposeError(s.startEngineToUseAi);
      return;
    }
    setIsComposing(true);
    setComposeError(null);
    try {
      setComposeResult(await client.proposePipeline(composePrompt.trim()));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      setComposeError(s.composeFailed.replace("{message}", message));
    } finally {
      setIsComposing(false);
    }
  }, [composePrompt]);

  const handleAsk = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (askPrompt.trim() === "") {
      setAskError(s.askEmpty);
      return;
    }
    if (client === null) {
      setAskError(s.startEngineToUseAi);
      return;
    }
    setIsAsking(true);
    setAskError(null);
    try {
      // Pass the current pipeline as context so the answer can reference
      // specific node names; omit it when the canvas is empty — the engine
      // treats absent pipelines as a general Q&A.
      const pipeline = pipelineDef.nodes.length > 0 ? pipelineDef : undefined;
      setAskResult(await client.askLLM(askPrompt.trim(), pipeline));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      setAskError(s.askFailed.replace("{message}", message));
    } finally {
      setIsAsking(false);
    }
  }, [askPrompt, pipelineDef]);

  // Replace the notebook with the drafted cells through the existing
  // webview→host patch protocol: delete every current cell (highest index
  // first so indices stay valid), then insert the drafted cells in order.
  // The host applies each patch as a WorkspaceEdit (undo-friendly) and
  // re-ingests after every change, so graph state converges on its own.
  const handleApplyProposal = useCallback((): void => {
    if (composeResult === null || composeResult.cellSources.length === 0) {
      return;
    }
    for (let cellIndex = cells.length - 1; cellIndex >= 0; cellIndex -= 1) {
      vscode.postMessage({ type: "patch", cellIndex, operation: "delete", newSource: null });
    }
    composeResult.cellSources.forEach((source, cellIndex) => {
      vscode.postMessage({
        type: "patch",
        cellIndex,
        operation: "insert",
        newSource: source,
        cellType: "code",
      });
    });
    setSelected(null);
    setEvents([]);
    setExplanation(null);
    setIsComposeOpen(false);
    setComposeResult(null);
    setComposePrompt("");
    setComposeError(null);
  }, [cells.length, composeResult]);

  // Uploaded data files (CSVs etc.) a pipeline can read by name — the engine
  // stores them in its data dir and runs cells with that as the working
  // directory. Mirrors the web-app's Data rail.
  const refreshDataFiles = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (client === null) {
      setDataFiles([]);
      return;
    }
    try {
      setDataFiles(await client.listDataFiles());
    } catch {
      // Engine offline / older engine without /files — leave the list empty.
      setDataFiles([]);
    }
  }, []);

  useEffect(() => {
    if (engineUrl === null) {
      setDataFiles([]);
      return;
    }
    void refreshDataFiles();
  }, [engineUrl, refreshDataFiles]);

  const triggerUploadData = useCallback((): void => {
    const client = clientRef.current;
    if (client === null) {
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.tsv,.json,.parquet,.txt,.xlsx";
    input.onchange = (): void => {
      const file = input.files?.[0];
      if (file === undefined) {
        return;
      }
      void client
        .uploadDataFile(file)
        .then(() => refreshDataFiles())
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "unknown error";
          pushErrorEvent(s.uploadDataFailed.replace("{message}", message));
        });
    };
    input.click();
  }, [pushErrorEvent, refreshDataFiles]);

  const handleDeleteData = useCallback(
    (name: string): void => {
      const client = clientRef.current;
      if (client === null) {
        return;
      }
      void client
        .deleteDataFile(name)
        .then(() => refreshDataFiles())
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "unknown error";
          pushErrorEvent(s.deleteDataFailed.replace("{message}", message));
        });
    },
    [pushErrorEvent, refreshDataFiles],
  );

  // Cmd/Ctrl+K toggles the Ask AI palette; bare M toggles the minimap
  // (suppressed while typing so it doesn't hijack editing), mirroring the
  // web app.
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

  const bodyStyle = useMemo(
    () => ({
      gridTemplateColumns: isSidebarCollapsed
        ? "minmax(0, 1fr)"
        : `minmax(${MIN_CANVAS_WIDTH_PX}px, 1fr) ${DIVIDER_SIZE_PX}px ${sidebarWidth}px`,
    }),
    [isSidebarCollapsed, sidebarWidth],
  );

  const runPipeline = (): void => {
    if (engineUrl === null || isRunning) {
      return;
    }
    setEvents([]);
    setTimingByNode({});
    setRowsByNode({});
    setRunSummary(null);
    const initialRuntime: Record<string, RuntimeState> = {};
    for (const nodeId of Object.keys(graph.nodes)) {
      initialRuntime[nodeId] = "queued";
    }
    setRuntimeByNode(initialRuntime);
    setIsRunning(true);

    const outputCellIndices = Array.from(
      new Set(
        pipelineDef.nodes
          .flatMap((node) => node.cellIndices)
          .filter((cellIndex) => Number.isInteger(cellIndex) && cellIndex >= 0),
      ),
    );
    if (outputCellIndices.length > 0) {
      vscode.postMessage({ type: "clearOutputs", cellIndices: outputCellIndices });
    }

    const wsUrl = `${engineUrl.replace(/^http/, "ws")}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "run", pipelineId: "vscode-run", pipeline: pipelineDef }));
    });

    ws.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(event.data as string) as EngineEvent;
        setEvents((prev) => [...prev, parsed]);
        if (parsed.type === "nodeStarted") {
          setRuntimeByNode((prev) => ({ ...prev, [parsed.nodeId]: "running" }));
        }
        if (parsed.type === "nodeCompleted") {
          const cellIndex = graph.nodes[parsed.result.nodeId]?.cellIndices[0];
          if (cellIndex !== undefined) {
            vscode.postMessage({
              type: "replaceOutputs",
              cellIndex,
              outputs: parsed.result.outputs,
              status: parsed.result.status,
              durationMs: parsed.result.durationMs,
            });
          }
          const status = parsed.result.status;
          if (status === "ok" || status === "error" || status === "skipped") {
            setRuntimeByNode((prev) => ({ ...prev, [parsed.result.nodeId]: status }));
          }
          setTimingByNode((prev) => ({
            ...prev,
            [parsed.result.nodeId]: parsed.result.durationMs,
          }));
          const rows = parsed.result.metadata?.rows;
          if (rows !== undefined) {
            setRowsByNode((prev) => ({ ...prev, [parsed.result.nodeId]: rows }));
          }
        }
        if (parsed.type === "pipelineCompleted") {
          setRunSummary({
            totalNodes: parsed.results.length,
            ok: parsed.results.filter((r) => r.status === "ok").length,
            error: parsed.results.filter((r) => r.status === "error").length,
            skipped: parsed.results.filter((r) => r.status === "skipped").length,
            totalDurationMs: parsed.results.reduce((sum, r) => sum + r.durationMs, 0),
          });
        }
        if (parsed.type === "pipelineCompleted" || parsed.type === "error") {
          setIsRunning(false);
          ws.close();
        }
      } catch {
        // Malformed message — leave isRunning true so the user can see the WS still open.
      }
    });

    ws.addEventListener("close", () => {
      setIsRunning(false);
    });
    ws.addEventListener("error", () => {
      setIsRunning(false);
    });
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b bg-card px-4 py-2">
        <span className="text-sm font-semibold">NotebookFlow</span>
        <span className="text-xs text-muted-foreground">
          {s.nodeCount.replace("{count}", String(Object.keys(graph.nodes).length))}
        </span>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className={engineUrl === null ? "text-muted-foreground" : "text-foreground"}>
            {s.enginePrefix}
            {engineUrl ?? s.engineNotRunning}
          </span>
          <button
            type="button"
            onClick={() => {
              void handleExplain();
            }}
            disabled={engineUrl === null || isExplaining}
            title={s.explainTitle}
            className="flex items-center gap-1 rounded border border-border bg-background px-3 py-1 disabled:opacity-50"
          >
            <Sparkles className="size-3" />
            {isExplaining ? s.explaining : s.explain}
          </button>
          <button
            type="button"
            onClick={() => {
              setIsComposeOpen(true);
            }}
            title={s.composeTitle}
            className="flex items-center gap-1 rounded border border-border bg-background px-3 py-1 disabled:opacity-50"
          >
            <Wand2 className="size-3" />
            {s.compose}
          </button>
          <button
            type="button"
            onClick={() => {
              setIsAskOpen(true);
            }}
            title={s.askAiTitle}
            className="flex items-center gap-1 rounded border border-border bg-background px-3 py-1 disabled:opacity-50"
          >
            <Command className="size-3" />
            {s.askAi}
          </button>
          <button
            type="button"
            onClick={toggleSidebar}
            className="rounded border border-border bg-background px-3 py-1 disabled:opacity-50"
          >
            {isSidebarCollapsed ? s.showSidebar : s.hideSidebar}
          </button>
          <button
            type="button"
            onClick={runPipeline}
            disabled={engineUrl === null || isRunning}
            className="rounded border border-border bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
          >
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
      <div ref={bodyRef} className="grid min-h-0 flex-1 overflow-hidden" style={bodyStyle}>
        <main className="relative min-h-0 min-w-0">
          <Canvas
            graph={graph}
            selectedNodeId={selected?.id ?? null}
            activeGroupId={notebookPath === "" ? null : notebookPath}
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
            onPointerDown={handleSidebarDividerPointerDown}
            onKeyDown={handleSidebarDividerKeyDown}
            className="group flex w-[10px] cursor-col-resize items-center justify-center border-0 bg-muted/70 p-0"
          >
            <span className="h-14 w-1 rounded-full bg-border transition-colors group-hover:bg-foreground/30 group-active:bg-foreground/45" />
          </button>
        )}

        {!isSidebarCollapsed && (
          <aside className="flex min-h-0 flex-col overflow-hidden border-l bg-card text-xs">
            <div className="max-h-[min(280px,42%)] min-h-[7rem] shrink-0 overflow-auto border-b p-3">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {s.selectedHeading}
              </h2>
              {selected === null ? (
                <p className="text-muted-foreground">{s.clickNodeToInspect}</p>
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
                <pre className="overflow-auto rounded border bg-background p-2 font-mono text-[11px]">
                  {JSON.stringify(selected, null, 2)}
                </pre>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {s.paletteHeading}
                </h2>
                <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {paletteNodes.length}
                </span>
              </div>
              {paletteNodes.length > 0 && (
                <div className="mb-3 flex flex-col gap-2 border-b pb-2">
                  <input
                    type="text"
                    value={paletteSearch}
                    onChange={(event) => {
                      setPaletteSearch(event.target.value);
                    }}
                    placeholder={s.paletteSearchPlaceholder}
                    aria-label={s.paletteSearchLabel}
                    className="rounded border bg-background px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring"
                  />
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={clearPaletteFilters}
                      className={
                        paletteTagFilter.size === 0
                          ? "rounded-full border border-foreground bg-foreground px-2 py-0.5 text-[10px] uppercase tracking-wider text-background transition-colors"
                          : "rounded-full border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted/70"
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
                        className={
                          paletteTagFilter.has(tag)
                            ? "rounded-full border border-foreground bg-foreground px-2 py-0.5 text-[10px] uppercase tracking-wider text-background transition-colors"
                            : "rounded-full border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted/70"
                        }
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {paletteError !== null ? (
                <p className="text-muted-foreground">{paletteError}</p>
              ) : paletteNodes.length === 0 ? (
                <p className="text-muted-foreground">{s.loadingRegistry}</p>
              ) : filteredPaletteNodes.length === 0 ? (
                <p className="text-muted-foreground">{s.paletteNoMatches}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {groupPalette(filteredPaletteNodes).map(([tag, nodes]) => (
                    <section key={tag} className="flex flex-col gap-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {tag}
                      </div>
                      <div className="flex flex-col gap-2">
                        {nodes.map((manifest) => (
                          <button
                            key={manifest.id}
                            type="button"
                            draggable={engineUrl !== null}
                            disabled={engineUrl === null}
                            onDragStart={(event) => {
                              setPaletteDragData(event.dataTransfer, manifest.id);
                            }}
                            onClick={() => {
                              handleAddNode(manifest);
                            }}
                            title={engineUrl === null ? s.startEngineToAddNodes : s.appendOrDrag}
                            className="cursor-grab rounded border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/70 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">{manifest.name}</span>
                              <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                                {manifest.tag}
                              </span>
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
                  ))}
                </div>
              )}

              <div className="mb-2 mt-4 flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {s.dataHeading}
                </h2>
                <button
                  type="button"
                  onClick={triggerUploadData}
                  disabled={engineUrl === null}
                  title={s.uploadData}
                  aria-label={s.uploadData}
                  className="flex items-center rounded border border-border bg-background p-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Upload className="size-3" />
                </button>
              </div>
              {engineUrl === null ? (
                <p className="text-muted-foreground">{s.startEngineForData}</p>
              ) : dataFiles.length === 0 ? (
                <p className="text-muted-foreground">{s.dataEmpty}</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {dataFiles.map((file) => (
                    <li
                      key={file.name}
                      className="flex items-center gap-2 rounded border bg-background px-2 py-1"
                    >
                      <Database className="size-3 shrink-0 text-muted-foreground" />
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-[11px]"
                        title={file.name}
                      >
                        {file.name}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {formatBytes(file.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          handleDeleteData(file.name);
                        }}
                        title={s.deleteDataFile.replace("{name}", file.name)}
                        aria-label={s.deleteDataFile.replace("{name}", file.name)}
                        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <h2 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {s.executionEvents.replace("{count}", String(events.length))}
              </h2>
              {events.length === 0 ? (
                <p className="text-muted-foreground">
                  {engineUrl === null ? s.startEngineToRun : s.clickRunToDispatch}
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {events.map((event, idx) => (
                    <li
                      key={`${event.type}-${String(idx)}`}
                      className="rounded border bg-background p-2 font-mono text-[11px]"
                    >
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

/** True when the event target is a text-editing surface (input/textarea/contenteditable). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
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
