/**
 * App — the React surface that lives inside the SplitView Lumino widget.
 *
 * Owns the SyncEngine, listens to the NotebookBridge for cell changes, and
 * renders the shared Canvas with a small run-pipeline control. The Lumino
 * host passes in the bridge and a one-shot ``run`` callback via props so
 * this component stays platform-agnostic.
 */

import type { GraphModel, NodeModel } from "@notebookflow/graph-canvas";
import { Canvas } from "@notebookflow/graph-canvas";
import type { CellPatch } from "@notebookflow/graph-canvas/sync";
import { SyncEngine } from "@notebookflow/graph-canvas/sync";
import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";

import type { EngineEvent, PipelineDef } from "./EngineClient";
import type { NotebookBridge } from "./NotebookBridge";

export interface AppProps {
  bridge: NotebookBridge;
  onRun: (pipeline: PipelineDef, onEvent: (event: EngineEvent) => void) => Promise<void>;
}

const EMPTY_GRAPH: GraphModel = { nodes: {}, groups: {}, wires: {} };

export function App({ bridge, onRun }: AppProps): ReactElement {
  const [graph, setGraph] = useState<GraphModel>(EMPTY_GRAPH);
  const [selected, setSelected] = useState<NodeModel | null>(null);
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const engine = useMemo<SyncEngine>(
    () =>
      new SyncEngine({
        onGraphUpdate: setGraph,
        onCellPatch: (patch: CellPatch): Promise<void> => {
          bridge.applyPatch(patch.cellIndex, patch.newSource);
          return Promise.resolve();
        },
      }),
    [bridge],
  );

  useEffect(() => {
    const ingest = (): void => {
      void engine.ingestNotebook(bridge.notebookPath, bridge.readCells(), Date.now());
    };
    ingest();
    bridge.changed.connect(ingest);
    return () => {
      bridge.changed.disconnect(ingest);
    };
  }, [bridge, engine]);

  const handleRename = (nodeId: string, nextName: string): void => {
    void engine.renameNode(nodeId, nextName, Date.now());
  };

  const handleRun = (): void => {
    if (isRunning) {
      return;
    }
    const pipeline = buildPipelineDef(graph, bridge.readCells(), bridge.notebookPath);
    setEvents([]);
    setIsRunning(true);
    void onRun(pipeline, (event) => {
      setEvents((prev) => [...prev, event]);
    })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "unknown error";
        setEvents((prev) => [...prev, { type: "error", message }]);
      })
      .finally(() => {
        setIsRunning(false);
      });
  };

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <span style={{ fontWeight: 600 }}>NotebookFlow</span>
        <span style={{ opacity: 0.65, fontSize: 11 }}>
          {Object.keys(graph.nodes).length} nodes · {bridge.notebookPath}
        </span>
        <button type="button" style={buttonStyle} onClick={handleRun} disabled={isRunning}>
          {isRunning ? "Running…" : "Run pipeline"}
        </button>
      </header>
      <div style={bodyStyle}>
        <main style={canvasStyle}>
          <Canvas graph={graph} onNodeRename={handleRename} onNodeSelect={setSelected} />
        </main>
        <aside style={sidebarStyle}>
          <h3 style={sectionTitleStyle}>Selected</h3>
          {selected === null ? (
            <p style={mutedStyle}>Click a node.</p>
          ) : (
            <pre style={preStyle}>{JSON.stringify(selected, null, 2)}</pre>
          )}
          <h3 style={sectionTitleStyle}>Execution ({events.length})</h3>
          {events.length === 0 ? (
            <p style={mutedStyle}>Click Run to dispatch this pipeline.</p>
          ) : (
            <ul style={eventListStyle}>
              {events.map((event, idx) => (
                <li key={`${event.type}-${String(idx)}`} style={eventItemStyle}>
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
  cells: { source: string }[],
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

const buttonStyle = {
  marginLeft: "auto",
  border: "1px solid var(--jp-border-color1, #9ca3af)",
  background: "var(--jp-brand-color1, #2563eb)",
  color: "#ffffff",
  borderRadius: 3,
  padding: "3px 10px",
  cursor: "pointer",
  fontSize: 11,
} as const;

const bodyStyle = { display: "flex", flex: 1, minHeight: 0 } as const;

const canvasStyle = { flex: 1, position: "relative" } as const;

const sidebarStyle = {
  width: 280,
  padding: 10,
  borderLeft: "1px solid var(--jp-border-color2, #d1d5db)",
  overflow: "auto",
  fontSize: 11,
  background: "var(--jp-layout-color1, #ffffff)",
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
