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
 *   { type: "patch", cellIndex, newSource } — every SyncEngine cell patch
 */

import type { GraphModel, NodeModel } from "@notebookflow/graph-canvas";
import { Canvas } from "@notebookflow/graph-canvas";
import type { CellPatch, NotebookCell } from "@notebookflow/graph-canvas/sync";
import { SyncEngine } from "@notebookflow/graph-canvas/sync";
import type { ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

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

interface ExecutionResultMsg {
  nodeId: string;
  status: string;
  error: string | null;
  durationMs: number;
}

type EngineEvent =
  | { type: "executionStarted"; pipelineId: string }
  | { type: "nodeCompleted"; pipelineId: string; result: ExecutionResultMsg }
  | { type: "pipelineCompleted"; pipelineId: string; results: ExecutionResultMsg[] }
  | { type: "error"; pipelineId?: string; message: string };

const EMPTY_GRAPH: GraphModel = { nodes: {}, groups: {}, wires: {} };

export function App(): ReactElement {
  const [graph, setGraph] = useState<GraphModel>(EMPTY_GRAPH);
  const [cells, setCells] = useState<NotebookCell[]>([]);
  const [engineUrl, setEngineUrl] = useState<string | null>(null);
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [selected, setSelected] = useState<NodeModel | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const engine = new SyncEngine({
      onGraphUpdate: setGraph,
      onCellPatch: (patch: CellPatch): Promise<void> => {
        vscode.postMessage({
          type: "patch",
          cellIndex: patch.cellIndex,
          newSource: patch.newSource,
        });
        return Promise.resolve();
      },
    });
    engineRef.current = engine;

    const handler = (event: MessageEvent<HostMessage>): void => {
      const msg = event.data;
      if (msg.type === "ingest") {
        setCells(msg.cells);
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

  const pipelineDef = useMemo(() => buildPipelineDef(graph, cells), [graph, cells]);

  const runPipeline = (): void => {
    if (engineUrl === null || isRunning) {
      return;
    }
    setEvents([]);
    setIsRunning(true);

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
            onClick={runPipeline}
            disabled={engineUrl === null || isRunning}
            className="rounded border border-border bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
          >
            {isRunning ? "Running…" : "Run pipeline"}
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="relative flex-1">
          <Canvas graph={graph} onNodeRename={handleRename} onNodeSelect={setSelected} />
        </main>
        <aside className="w-80 overflow-auto border-l bg-card p-3 text-xs">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
