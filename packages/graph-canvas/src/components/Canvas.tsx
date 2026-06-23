/**
 * Canvas — top-level React Flow surface.
 *
 * Translates a platform-neutral GraphModel into React Flow node + edge
 * arrays and forwards interactive edits back to the parent through the
 * `onNode*` / `onWire*` callbacks. Phase-2 layout is deterministic: each
 * NodeGroup is rendered as a header card at the top of its column, and the
 * group's nodes are stacked beneath in cellIndex order. Positions are not
 * draggable yet — a future iteration will introduce free-form layout.
 */

import type { ReactElement } from "react";
import { useCallback, useMemo } from "react";
import type { Connection, Edge, EdgeTypes, Node, NodeTypes } from "reactflow";
import { Background, Controls, MiniMap, Panel, ReactFlow } from "reactflow";

import type { GraphModel, NodeModel, NodeTag, RunSummary, RuntimeState, WireModel } from "../types";
import type { NotebookNodeData } from "./Node";
import { NotebookNode } from "./Node";
import type { NodeGroupData } from "./NodeGroup";
import { NodeGroup } from "./NodeGroup";
import type { WireData } from "./Wire";
import { Wire } from "./Wire";

const NODE_TYPES = {
  notebook: NotebookNode,
  group: NodeGroup,
} satisfies NodeTypes;

const MINIMAP_TAG_COLOR: Record<NodeTag, string> = {
  input: "#3b82f6",
  transform: "#10b981",
  output: "#ef4444",
  ai: "#a855f7",
  io: "#f97316",
};

function miniMapNodeColor(node: Node): string {
  if (node.type === "group") {
    return "#9ca3af";
  }
  const data = node.data as NotebookNodeData | undefined;
  const tag = data?.tag;
  return tag === undefined ? "#9ca3af" : MINIMAP_TAG_COLOR[tag];
}

const EDGE_TYPES = {
  wire: Wire,
} satisfies EdgeTypes;

const COLUMN_WIDTH = 320;
const GROUP_Y = 0;
const FIRST_NODE_Y = 70;
const NODE_VERTICAL_SPACING = 140;

const FLOW_STYLE = {
  width: "100%",
  height: "100%",
  color: "var(--notebookflow-canvas-fg, #111827)",
  fontFamily:
    "var(--notebookflow-font-family, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif)",
  lineHeight: 1.4,
} as const;

export interface CanvasProps {
  graph: GraphModel;
  onNodeRename?: (nodeId: string, nextName: string) => void;
  onWireCreate?: (wire: Omit<WireModel, "id">) => void;
  onWireDelete?: (wireId: string) => void;
  onNodeSelect?: (node: NodeModel | null) => void;
  onGroupToggle?: (groupId: string) => void;
  /** Replace a node's declared input refs (nodeName.portName). */
  onInputsChange?: (nodeId: string, nextInputs: string[]) => void;
  /** Replace a node's declared output port names. */
  onOutputsChange?: (nodeId: string, nextOutputs: string[]) => void;
  /**
   * Variable names defined in each node's cell(s), keyed by node id. Used to
   * enrich port autocomplete with real identifiers from the code, not just
   * already-declared ports. Typically sourced from the engine's analyzer.
   */
  variablesByNode?: Record<string, string[]>;
  /**
   * Per-node execution state for the run-status indicator. Hosts populate this
   * from engine WebSocket events; nodes not present default to "idle".
   */
  runtimeByNode?: Record<string, RuntimeState>;
  /**
   * Per-node last-run duration in milliseconds. Rendered next to the status
   * dot once the node enters a terminal state.
   */
  timingByNode?: Record<string, number>;
  /**
   * Summary of the most recent pipeline run, rendered as a bottom-center
   * overlay. Hosts compute it from pipelineCompleted events.
   */
  runSummary?: RunSummary | null;
}

export function Canvas(props: CanvasProps): ReactElement {
  const {
    graph,
    onNodeRename,
    onWireCreate,
    onWireDelete,
    onNodeSelect,
    onGroupToggle,
    onInputsChange,
    onOutputsChange,
    variablesByNode,
    runtimeByNode,
    timingByNode,
    runSummary,
  } = props;

  const rfNodes = useMemo<Node[]>(
    () =>
      buildNodes(graph, {
        onNodeRename,
        onGroupToggle,
        onInputsChange,
        onOutputsChange,
        variablesByNode,
        runtimeByNode,
        timingByNode,
      }),
    [
      graph,
      onNodeRename,
      onGroupToggle,
      onInputsChange,
      onOutputsChange,
      variablesByNode,
      runtimeByNode,
      timingByNode,
    ],
  );

  const rfEdges = useMemo<Edge<WireData>[]>(() => buildRfEdges(graph), [graph]);

  const handleConnect = useCallback(
    (conn: Connection): void => {
      if (
        onWireCreate === undefined ||
        conn.source === null ||
        conn.target === null ||
        conn.sourceHandle === null ||
        conn.targetHandle === null
      ) {
        return;
      }
      onWireCreate({
        sourceNodeId: conn.source,
        sourcePort: conn.sourceHandle,
        targetNodeId: conn.target,
        targetPort: conn.targetHandle,
      });
    },
    [onWireCreate],
  );

  const handleNodeClick = useCallback(
    (_event: unknown, node: Node): void => {
      if (onNodeSelect === undefined) {
        return;
      }
      if (node.type !== "notebook") {
        return;
      }
      const found = graph.nodes[node.id];
      onNodeSelect(found ?? null);
    },
    [graph, onNodeSelect],
  );

  const handlePaneClick = useCallback((): void => {
    if (onNodeSelect !== undefined) {
      onNodeSelect(null);
    }
  }, [onNodeSelect]);

  const handleEdgesDelete = useCallback(
    (edges: Edge[]): void => {
      if (onWireDelete === undefined) {
        return;
      }
      for (const edge of edges) {
        onWireDelete(edge.id);
      }
    },
    [onWireDelete],
  );

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      className="notebookflow-canvas"
      style={FLOW_STYLE}
      onConnect={handleConnect}
      onNodeClick={handleNodeClick}
      onPaneClick={handlePaneClick}
      onEdgesDelete={handleEdgesDelete}
      nodesDraggable={false}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls />
      <MiniMap
        nodeColor={miniMapNodeColor}
        nodeStrokeWidth={2}
        pannable
        zoomable
        position="bottom-right"
        ariaLabel="Canvas minimap"
      />
      <Panel position="top-left">
        <KeyboardLegend />
      </Panel>
      <Panel position="top-right">
        <CanvasBreadcrumbs graph={graph} />
      </Panel>
      {runSummary !== undefined && runSummary !== null && (
        <Panel position="bottom-center">
          <RunSummaryOverlay summary={runSummary} />
        </Panel>
      )}
    </ReactFlow>
  );
}

function buildNodes(
  graph: GraphModel,
  callbacks: {
    onNodeRename: CanvasProps["onNodeRename"];
    onGroupToggle: CanvasProps["onGroupToggle"];
    onInputsChange: CanvasProps["onInputsChange"];
    onOutputsChange: CanvasProps["onOutputsChange"];
    variablesByNode: CanvasProps["variablesByNode"];
    runtimeByNode: CanvasProps["runtimeByNode"];
    timingByNode: CanvasProps["timingByNode"];
  },
): Node[] {
  const {
    onNodeRename: onRename,
    onGroupToggle,
    onInputsChange,
    onOutputsChange,
    variablesByNode,
    runtimeByNode,
    timingByNode,
  } = callbacks;
  const vars = variablesByNode ?? {};
  const runtime = runtimeByNode ?? {};
  const timing = timingByNode ?? {};
  const rfNodes: Node[] = [];
  const groupIds = Object.keys(graph.groups).sort();

  for (let columnIdx = 0; columnIdx < groupIds.length; columnIdx++) {
    const groupId = groupIds[columnIdx];
    if (groupId === undefined) {
      continue;
    }
    const group = graph.groups[groupId];
    if (group === undefined) {
      continue;
    }

    const groupX = columnIdx * COLUMN_WIDTH;
    const groupData: NodeGroupData = { ...group };
    if (onGroupToggle !== undefined) {
      groupData.onToggle = onGroupToggle;
    }
    rfNodes.push({
      id: `group:${group.id}`,
      type: "group",
      position: { x: groupX, y: GROUP_Y },
      data: groupData,
      draggable: false,
      selectable: true,
    });

    if (group.collapsed) {
      continue;
    }

    const groupNodes = group.nodeIds
      .map((id) => graph.nodes[id])
      .filter((n): n is NodeModel => n !== undefined)
      .sort((a, b) => (a.cellIndices[0] ?? 0) - (b.cellIndices[0] ?? 0));

    for (let rowIdx = 0; rowIdx < groupNodes.length; rowIdx++) {
      const node = groupNodes[rowIdx];
      if (node === undefined) {
        continue;
      }
      const nodeData: NotebookNodeData = {
        ...node,
        runtimeState: runtime[node.id] ?? "idle",
      };
      const duration = timing[node.id];
      if (duration !== undefined) {
        nodeData.runtimeDurationMs = duration;
      }
      if (onRename !== undefined) {
        nodeData.onRename = onRename;
      }
      if (onInputsChange !== undefined) {
        nodeData.onInputsChange = onInputsChange;
        nodeData.inputSuggestions = collectInputRefs(graph, vars, node.id);
      }
      if (onOutputsChange !== undefined) {
        nodeData.onOutputsChange = onOutputsChange;
        nodeData.outputSuggestions = collectOutputSuggestions(node, vars);
      }
      rfNodes.push({
        id: node.id,
        type: "notebook",
        position: { x: groupX, y: FIRST_NODE_Y + rowIdx * NODE_VERTICAL_SPACING },
        data: nodeData,
        draggable: false,
        selectable: true,
      });
    }
  }

  return rfNodes;
}

const LEGEND_STYLE = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  padding: "4px 10px",
  borderRadius: 6,
  background: "var(--notebookflow-legend-bg, rgba(255, 255, 255, 0.86))",
  color: "var(--notebookflow-legend-fg, #4b5563)",
  fontSize: 10,
  fontFamily: "var(--notebookflow-font-family, ui-sans-serif, system-ui, sans-serif)",
  letterSpacing: "0.02em",
  border: "1px solid var(--notebookflow-legend-border, #e5e7eb)",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05)",
  pointerEvents: "none",
} as const;

const LEGEND_KEY_STYLE = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 9.5,
  color: "var(--notebookflow-legend-fg, #1f2937)",
  marginRight: 4,
} as const;

const BREADCRUMBS_STYLE = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  padding: "4px 10px",
  borderRadius: 6,
  background: "var(--notebookflow-legend-bg, rgba(255, 255, 255, 0.86))",
  color: "var(--notebookflow-legend-fg, #4b5563)",
  fontSize: 10.5,
  fontFamily: "var(--notebookflow-font-family, ui-sans-serif, system-ui, sans-serif)",
  letterSpacing: "0.02em",
  border: "1px solid var(--notebookflow-legend-border, #e5e7eb)",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05)",
  pointerEvents: "none",
} as const;

const BREADCRUMBS_PATH_STYLE = {
  color: "var(--notebookflow-legend-fg, #1f2937)",
  fontWeight: 500,
} as const;

const RUN_SUMMARY_STYLE = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  padding: "5px 12px",
  borderRadius: 999,
  background: "var(--notebookflow-legend-bg, rgba(255, 255, 255, 0.92))",
  color: "var(--notebookflow-legend-fg, #4b5563)",
  fontSize: 10.5,
  fontFamily: "var(--notebookflow-font-family, ui-sans-serif, system-ui, sans-serif)",
  letterSpacing: "0.02em",
  border: "1px solid var(--notebookflow-legend-border, #e5e7eb)",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05)",
  pointerEvents: "none",
} as const;

const RUN_SUMMARY_CHIP_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 10,
} as const;

function RunSummaryOverlay({ summary }: { summary: RunSummary }): ReactElement {
  const { totalNodes, ok, error, skipped, totalDurationMs } = summary;
  const overallStatus = error > 0 ? "error" : skipped > 0 ? "partial" : ok > 0 ? "ok" : "empty";
  const overallColor =
    overallStatus === "ok"
      ? "#10b981"
      : overallStatus === "partial"
        ? "#f59e0b"
        : overallStatus === "error"
          ? "#ef4444"
          : "#9ca3af";
  const overallLabel =
    overallStatus === "ok"
      ? "completed"
      : overallStatus === "partial"
        ? "partial"
        : overallStatus === "error"
          ? "failed"
          : "no nodes";
  return (
    <div role="img" aria-label="Last run summary" style={RUN_SUMMARY_STYLE}>
      <span style={RUN_SUMMARY_CHIP_STYLE}>
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: overallColor,
          }}
        />
        {overallLabel}
      </span>
      <span style={RUN_SUMMARY_CHIP_STYLE}>
        {totalNodes === 1 ? "1 node" : `${String(totalNodes)} nodes`}
      </span>
      {ok > 0 && (
        <span style={{ ...RUN_SUMMARY_CHIP_STYLE, color: "#10b981" }}>✓ {String(ok)}</span>
      )}
      {error > 0 && (
        <span style={{ ...RUN_SUMMARY_CHIP_STYLE, color: "#ef4444" }}>✗ {String(error)}</span>
      )}
      {skipped > 0 && (
        <span style={{ ...RUN_SUMMARY_CHIP_STYLE, color: "#f59e0b" }}>↷ {String(skipped)}</span>
      )}
      <span style={RUN_SUMMARY_CHIP_STYLE}>{formatRunDuration(totalDurationMs)}</span>
    </div>
  );
}

function formatRunDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "—";
  }
  if (ms < 1000) {
    return `${String(Math.round(ms))}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms - minutes * 60_000) / 1000);
  return `${String(minutes)}m ${String(seconds)}s`;
}

function CanvasBreadcrumbs({ graph }: { graph: GraphModel }): ReactElement {
  const nodeCount = Object.keys(graph.nodes).length;
  const groups = Object.values(graph.groups);
  const singleGroup = groups.length === 1 ? groups[0] : undefined;
  return (
    <div role="img" aria-label="Canvas summary" style={BREADCRUMBS_STYLE}>
      <span style={BREADCRUMBS_PATH_STYLE}>
        Graph
        {singleGroup === undefined ? "" : ` / ${singleGroup.name}`}
      </span>
      <span>· {nodeCount === 1 ? "1 node" : `${String(nodeCount)} nodes`}</span>
      {groups.length > 1 && (
        <span>· {groups.length === 1 ? "1 group" : `${String(groups.length)} groups`}</span>
      )}
    </div>
  );
}

function KeyboardLegend(): ReactElement {
  return (
    <div role="img" aria-label="Canvas gesture hints" style={LEGEND_STYLE}>
      <span>
        <span style={LEGEND_KEY_STYLE}>drag</span>pan
      </span>
      <span>
        <span style={LEGEND_KEY_STYLE}>⌘ + wheel</span>zoom
      </span>
      <span>
        <span style={LEGEND_KEY_STYLE}>click</span>select
      </span>
      <span>
        <span style={LEGEND_KEY_STYLE}>dblclick</span>rename
      </span>
    </div>
  );
}

function buildRfEdges(graph: GraphModel): Edge<WireData>[] {
  const edges: Edge<WireData>[] = [];
  for (const wire of Object.values(graph.wires)) {
    const sourceNode = graph.nodes[wire.sourceNodeId];
    const targetNode = graph.nodes[wire.targetNodeId];
    if (sourceNode === undefined || targetNode === undefined) {
      continue;
    }
    edges.push({
      id: wire.id,
      source: wire.sourceNodeId,
      sourceHandle: wire.sourcePort,
      target: wire.targetNodeId,
      targetHandle: wire.targetPort,
      type: "wire",
      data: { crossNotebook: sourceNode.groupId !== targetNode.groupId },
    });
  }
  return edges;
}

/** Valid output port name per the marker grammar (lowercase identifier). */
const PORT_RE = /^[a-z][a-z0-9_]*$/;

/** Output port suggestions for a node: its declared ports plus cell variables. */
function collectOutputSuggestions(
  node: NodeModel,
  variablesByNode: Record<string, string[]>,
): string[] {
  const names = new Set<string>(node.outputs);
  for (const name of variablesByNode[node.id] ?? []) {
    if (PORT_RE.test(name)) {
      names.add(name);
    }
  }
  return [...names].sort();
}

/** Upstream `nodeName.portName` refs a node can consume, for input autocomplete. */
function collectInputRefs(
  graph: GraphModel,
  variablesByNode: Record<string, string[]>,
  selfId: string,
): string[] {
  const refs = new Set<string>();
  for (const node of Object.values(graph.nodes)) {
    if (node.id === selfId) {
      continue;
    }
    const ports = new Set<string>(node.outputs);
    for (const name of variablesByNode[node.id] ?? []) {
      if (PORT_RE.test(name)) {
        ports.add(name);
      }
    }
    for (const port of ports) {
      refs.add(`${node.name}.${port}`);
    }
  }
  return [...refs].sort();
}
