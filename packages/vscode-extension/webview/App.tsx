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

import type { GraphModel, NodeModel } from "@notebookflow/graph-canvas";
import { Canvas } from "@notebookflow/graph-canvas";
import type { CellPatch, NotebookCell } from "@notebookflow/graph-canvas/sync";
import { SyncEngine } from "@notebookflow/graph-canvas/sync";
import type {
  ReactElement,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

declare global {
  interface VsCodeApi {
    postMessage(msg: unknown): void;
    setState(state: unknown): void;
    getState(): unknown;
  }
  function acquireVsCodeApi(): VsCodeApi;
}

const vscode = acquireVsCodeApi();

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

type HostMessage = IngestMessage | EngineUrlMessage | EngineDownMessage;

interface NodeDef {
  id: string;
  name: string;
  tag: string;
  inputs: string[];
  outputs: string[];
  source: string;
  notebookPath: string;
  cellIndices: number[];
}

interface EdgeDef {
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
}

type NbOutput =
  | { output_type: "stream"; name: "stdout" | "stderr"; text: string }
  | {
    output_type: "display_data";
    data: Record<string, string>;
    metadata: Record<string, unknown>;
  }
  | {
    output_type: "execute_result";
    data: Record<string, string>;
    metadata: Record<string, unknown>;
  }
  | { output_type: "error"; ename: string; evalue: string; traceback: string[] };

interface NodePortDef {
  name: string;
  type: string;
  required: boolean;
}

interface NodeManifestDef {
  id: string;
  name: string;
  tag: "input" | "transform" | "output" | "ai" | "io";
  version: string;
  description: string;
  inputs: NodePortDef[];
  outputs: NodePortDef[];
  template: string;
}

interface ExecutionResultMsg {
  nodeId: string;
  status: string;
  error: string | null;
  durationMs: number;
  outputs: NbOutput[];
}

type EngineEvent =
  | { type: "executionStarted"; pipelineId: string }
  | { type: "nodeCompleted"; pipelineId: string; result: ExecutionResultMsg }
  | { type: "pipelineCompleted"; pipelineId: string; results: ExecutionResultMsg[] }
  | { type: "error"; pipelineId?: string; message: string };

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
  const [paletteNodes, setPaletteNodes] = useState<NodeManifestDef[]>([]);
  const [paletteError, setPaletteError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH_PX);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const lastOpenSidebarWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH_PX);

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
        setEngineUrl(msg.url);
      } else if (msg.type === "engineDown") {
        setEngineUrl(null);
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

  const handleRename = (nodeId: string, nextName: string): void => {
    void engineRef.current?.renameNode(nodeId, nextName, Date.now());
  };

  const handleAddNode = useCallback(
    (manifest: NodeManifestDef): void => {
      if (notebookPath === "") {
        return;
      }
      void engineRef.current?.createNode(
        notebookPath,
        {
          name: manifest.name,
          tag: manifest.tag,
          outputs: manifest.outputs.map((port) => port.name),
          bodySource: manifest.template,
          metadata: {
            notebookflow: {
              manifestId: manifest.id,
              manifestVersion: manifest.version,
            },
          },
        },
        Date.now(),
      );
    },
    [notebookPath],
  );

  useEffect(() => {
    if (engineUrl === null) {
      setPaletteNodes([]);
      setPaletteError("Start the engine to load the node palette.");
      return;
    }

    let cancelled = false;
    void fetch(`${engineUrl}/nodes`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        return (await response.json()) as NodeManifestDef[];
      })
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
  }, [engineUrl]);

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

  const pipelineDef = useMemo(() => buildPipelineDef(graph, cells), [graph, cells]);

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
          {Object.keys(graph.nodes).length} nodes
        </span>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className={engineUrl === null ? "text-muted-foreground" : "text-foreground"}>
            engine: {engineUrl ?? "not running"}
          </span>
          <button
            type="button"
            onClick={toggleSidebar}
            className="rounded border border-border bg-background px-3 py-1 disabled:opacity-50"
          >
            {isSidebarCollapsed ? "Show palette" : "Hide palette"}
          </button>
          <button
            type="button"
            onClick={runPipeline}
            disabled={engineUrl === null || isRunning}
            className="rounded border border-border bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
          >
            {isRunning ? "Running…" : "Run pipeline"}
          </button>
        </div>
      </header>
      <div ref={bodyRef} className="grid min-h-0 flex-1 overflow-hidden" style={bodyStyle}>
        <main className="relative min-h-0 min-w-0">
          <Canvas graph={graph} onNodeRename={handleRename} onNodeSelect={setSelected} />
        </main>

        {!isSidebarCollapsed && (
          <button
            type="button"
            aria-label="Resize palette sidebar"
            onPointerDown={handleSidebarDividerPointerDown}
            onKeyDown={handleSidebarDividerKeyDown}
            className="group flex w-[10px] cursor-col-resize items-center justify-center border-0 bg-muted/70 p-0"
          >
            <span className="h-14 w-1 rounded-full bg-border transition-colors group-hover:bg-foreground/30 group-active:bg-foreground/45" />
          </button>
        )}

        {!isSidebarCollapsed && (
          <aside className="min-h-0 overflow-auto border-l bg-card p-3 text-xs">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Palette
              </h2>
              <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                {paletteNodes.length}
              </span>
            </div>
            {paletteError !== null ? (
              <p className="text-muted-foreground">{paletteError}</p>
            ) : paletteNodes.length === 0 ? (
              <p className="text-muted-foreground">Loading node registry…</p>
            ) : (
              <div className="flex flex-col gap-3">
                {groupPalette(paletteNodes).map(([tag, nodes]) => (
                  <section key={tag} className="flex flex-col gap-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {tag}
                    </div>
                    <div className="flex flex-col gap-2">
                      {nodes.map((manifest) => (
                        <button
                          key={manifest.id}
                          type="button"
                          onClick={() => {
                            handleAddNode(manifest);
                          }}
                          className="rounded border bg-background px-3 py-2 text-left transition-colors hover:bg-muted"
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

            <h2 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Selected
            </h2>
            {selected === null ? (
              <p className="text-muted-foreground">Click a node to inspect.</p>
            ) : (
              <pre className="overflow-auto rounded border bg-background p-2 font-mono text-[11px]">
                {JSON.stringify(selected, null, 2)}
              </pre>
            )}

            <h2 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Execution events ({events.length})
            </h2>
            {events.length === 0 ? (
              <p className="text-muted-foreground">
                {engineUrl === null
                  ? "Start the engine to run pipelines."
                  : "Click Run to dispatch this pipeline."}
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
          </aside>
        )}
      </div>
    </div>
  );
}

function buildPipelineDef(
  graph: GraphModel,
  cells: NotebookCell[],
): { nodes: NodeDef[]; edges: EdgeDef[] } {
  const nodes: NodeDef[] = Object.values(graph.nodes).map((node) => {
    const cellIndex = node.cellIndices[0] ?? 0;
    const cell = cells[cellIndex];
    const source = cell?.source ?? "";
    const group = graph.groups[node.groupId];
    return {
      id: node.id,
      name: node.name,
      tag: node.tag,
      inputs: node.inputs,
      outputs: node.outputs,
      source: stripMarkerLine(source),
      notebookPath: group?.notebookPath ?? "",
      cellIndices: node.cellIndices,
    };
  });
  const edges: EdgeDef[] = Object.values(graph.wires).map((wire) => ({
    sourceNodeId: wire.sourceNodeId,
    sourcePort: wire.sourcePort,
    targetNodeId: wire.targetNodeId,
    targetPort: wire.targetPort,
  }));
  return { nodes, edges };
}

/** Drop the leading `# @node: …` marker line — it's metadata, not code to exec. */
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

function renderEvent(event: EngineEvent): string {
  switch (event.type) {
    case "executionStarted":
      return `▶ started ${event.pipelineId}`;
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
