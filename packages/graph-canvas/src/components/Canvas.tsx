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

import { Map as MapIcon, Network } from "lucide-react";
import type { DragEvent, ReactElement } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Connection, Edge, EdgeTypes, Node, NodeProps, NodeTypes } from "reactflow";
import {
  Background,
  ControlButton,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useStore,
  useStoreApi,
  useUpdateNodeInternals,
} from "reactflow";

import type { GraphModel, NodeModel, NodeTag, RunSummary, RuntimeState, WireModel } from "../types";
import type { PortPlacement } from "./InletOutletGrid";
import type { InsertSlotData } from "./InsertSlotNode";
import { InsertSlotNode, insertSlotId } from "./InsertSlotNode";
import { InsertDropContext } from "./insertDropContext";
import type { NotebookNodeData } from "./Node";
import { NotebookNode } from "./Node";
import type { NodeGroupData } from "./NodeGroup";
import { NODE_GROUP_HEADER_HEIGHT, NodeGroup } from "./NodeGroup";
import {
  applyMeasuredGroupLayout,
  estimateNodeHeight,
  estimateNodeWidth,
  type GroupLayoutConstants,
  horizontalGroupWidth,
  type MeasuredSize,
  measuredLayoutDiffers,
  NODE_GAP,
  type NodeLayoutHints,
  stackedGroupWidth,
} from "./nodeLayout";
import { isPaletteDrag, readPaletteDragManifestId } from "./paletteDragData";
import { collectInputRefs, collectOutputSuggestions } from "./portSuggestions";
import type { WireData } from "./Wire";
import { Wire } from "./Wire";

const NODE_TYPES = {
  notebook: MeasuredNotebookNode,
  group: NodeGroup,
  insertSlot: InsertSlotNode,
} satisfies NodeTypes;

export { NODE_DRAG_MIME } from "./nodeDragMime";

function MeasuredNotebookNode(props: NodeProps<NotebookNodeData>): ReactElement {
  const { id, data } = props;
  const updateNodeInternals = useUpdateNodeInternals();
  const metaLabel =
    data.meta?.filename !== undefined && data.meta.filename !== ""
      ? data.meta.filename
      : data.meta?.rows !== undefined && Number.isFinite(data.meta.rows)
        ? String(data.meta.rows)
        : "";
  const measureRevision = [
    data.portPlacement ?? "stacked",
    data.inputs.length,
    data.outputs.length,
    data.inputs.join("\0"),
    data.outputs.join("\0"),
    metaLabel,
    data.unresolvedInputs?.join("\0") ?? "",
  ].join("|");

  useLayoutEffect(() => {
    void measureRevision;
    updateNodeInternals(id);
  }, [id, measureRevision, updateNodeInternals]);

  return <NotebookNode {...props} />;
}

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
const COLUMN_GAP = 32;
const GROUP_Y = 0;
const NODE_X_INSET = 16;
const GROUP_INNER_TOP_PADDING = 16;
const GROUP_INNER_BOTTOM_PADDING = 24;
const COLLAPSED_GROUP_HEIGHT = NODE_GROUP_HEADER_HEIGHT;

const GROUP_INNER_RIGHT_PADDING = 16;

const GROUP_LAYOUT: GroupLayoutConstants = {
  columnWidth: COLUMN_WIDTH,
  columnGap: COLUMN_GAP,
  nodeXInset: NODE_X_INSET,
  groupInnerTopPadding: GROUP_INNER_TOP_PADDING,
  groupInnerBottomPadding: GROUP_INNER_BOTTOM_PADDING,
  groupInnerRightPadding: GROUP_INNER_RIGHT_PADDING,
  groupHeaderHeight: NODE_GROUP_HEADER_HEIGHT,
  collapsedGroupHeight: COLLAPSED_GROUP_HEIGHT,
  nodeGap: NODE_GAP,
};

export type CanvasLayout = "manual" | "dagre";

export interface PaneDropTarget {
  /** Flow coordinates when dropped on empty canvas space (appends to the active notebook). */
  position?: { x: number; y: number };
  /** Notebook group id (= notebook path) to insert into. */
  groupId?: string;
  /** Insert immediately after this cell index within the group notebook. */
  insertAfterCellIndex?: number;
}

const FLOW_STYLE = {
  width: "100%",
  height: "100%",
  color: "var(--notebookflow-canvas-fg, #111827)",
  fontFamily:
    "var(--notebookflow-font-family, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif)",
  lineHeight: 1.4,
} as const;

/** Wires render above nodes — RF paints nodes after edges in DOM, so edges need a higher z-index. */
const WIRE_LAYER_Z_INDEX = 2000;

const DEFAULT_EDGE_OPTIONS = {
  zIndex: WIRE_LAYER_Z_INDEX,
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
   * Per-node data hints for the meta line: input filename (static) + output
   * row count (post-run). Either field may be absent.
   */
  metaByNode?: Record<string, { filename?: string; rows?: number }>;
  /** Per-node input refs that don't resolve to a wire (shown as unresolved). */
  unresolvedByNode?: Record<string, string[]>;
  /**
   * Summary of the most recent pipeline run, rendered as a bottom-center
   * overlay. Hosts compute it from pipelineCompleted events.
   */
  runSummary?: RunSummary | null;
  /**
   * Fired when the user drops a palette item onto the canvas or a gap slot.
   * Gap drops include `groupId` and `insertAfterCellIndex` so hosts can insert
   * the new cell after the leading node in that notebook.
   */
  onPaneDrop?: (manifestId: string, target: PaneDropTarget) => void;
  /** Whether the minimap is shown. Off by default; toggled by the host (M). */
  showMinimap?: boolean;
  /** Toggle the minimap from the canvas control cluster. */
  onToggleMinimap?: () => void;
}

export function Canvas(props: CanvasProps): ReactElement {
  // Wrap in a Provider so useReactFlow() works inside CanvasInner -- without
  // this, the drop coordinate projection (screenToFlowPosition) would throw.
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner(props: CanvasProps): ReactElement {
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
    metaByNode,
    unresolvedByNode,
    runSummary,
    onPaneDrop,
    showMinimap,
    onToggleMinimap,
  } = props;

  const [layout, setLayout] = useState<CanvasLayout>("manual");
  const [paletteDragActive, setPaletteDragActive] = useState(false);
  const [hoveredSlotId, setHoveredSlotId] = useState<string | null>(null);
  const paletteDragDepthRef = useRef(0);

  useEffect(() => {
    const endPaletteDrag = (): void => {
      paletteDragDepthRef.current = 0;
      setPaletteDragActive(false);
      setHoveredSlotId(null);
    };
    document.addEventListener("dragend", endPaletteDrag);
    return () => {
      document.removeEventListener("dragend", endPaletteDrag);
    };
  }, []);

  const rfEdges = useMemo<Edge<WireData>[]>(() => buildRfEdges(graph), [graph]);

  const portPlacement: PortPlacement = layout === "manual" ? "stacked" : "sides";

  const baseNodes = useMemo<Node[]>(() => {
    return buildNodes(graph, {
      onNodeRename,
      onGroupToggle,
      onInputsChange,
      onOutputsChange,
      variablesByNode,
      runtimeByNode,
      timingByNode,
      metaByNode,
      unresolvedByNode,
      portPlacement,
    });
  }, [
    graph,
    onNodeRename,
    onGroupToggle,
    onInputsChange,
    onOutputsChange,
    variablesByNode,
    runtimeByNode,
    timingByNode,
    metaByNode,
    unresolvedByNode,
    portPlacement,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState(baseNodes);

  useEffect(() => {
    setNodes(baseNodes);
  }, [baseNodes, setNodes]);

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

  const isValidConnection = useCallback((conn: Connection): boolean => {
    if (
      conn.source === null ||
      conn.target === null ||
      conn.sourceHandle === null ||
      conn.targetHandle === null
    ) {
      return false;
    }
    // Wires must connect an outlet (source handle) to an inlet (target handle).
    if (conn.source === conn.target) {
      return false;
    }
    return true;
  }, []);

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

  // Drop-target wiring so the palette can drag manifests onto the canvas.
  // Screen coordinates from the DragEvent are projected into React Flow's
  // own coordinate space so the host can record the drop position.
  const reactFlow = useReactFlow();
  const handleWrapperDragEnter = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!isPaletteDrag(event.dataTransfer)) {
      return;
    }
    paletteDragDepthRef.current += 1;
    setPaletteDragActive(true);
  }, []);

  const handleWrapperDragLeave = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!isPaletteDrag(event.dataTransfer)) {
      return;
    }
    paletteDragDepthRef.current = Math.max(0, paletteDragDepthRef.current - 1);
    if (paletteDragDepthRef.current === 0) {
      setPaletteDragActive(false);
      setHoveredSlotId(null);
    }
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!isPaletteDrag(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleInsertDrop = useCallback(
    (manifestId: string, groupId: string, afterCellIndex: number): void => {
      if (onPaneDrop === undefined) {
        return;
      }
      onPaneDrop(manifestId, { groupId, insertAfterCellIndex: afterCellIndex });
    },
    [onPaneDrop],
  );

  const insertDropContextValue = useMemo(
    () => ({
      paletteDragActive,
      setPaletteDragActive,
      hoveredSlotId,
      setHoveredSlotId,
      onInsertDrop: handleInsertDrop,
    }),
    [paletteDragActive, hoveredSlotId, handleInsertDrop],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      if (onPaneDrop === undefined) {
        return;
      }
      const manifestId = readPaletteDragManifestId(event.dataTransfer);
      if (manifestId === "") {
        return;
      }
      event.preventDefault();
      paletteDragDepthRef.current = 0;
      setPaletteDragActive(false);
      setHoveredSlotId(null);
      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      onPaneDrop(manifestId, { position });
    },
    [onPaneDrop, reactFlow],
  );

  return (
    <InsertDropContext.Provider value={insertDropContextValue}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target for the palette drag-and-drop flow; keyboard equivalent is the palette's click-to-add */}
      <div
        style={{ width: "100%", height: "100%" }}
        onDragEnter={handleWrapperDragEnter}
        onDragLeave={handleWrapperDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <style>{`.notebookflow-canvas .react-flow__handle { border: none; outline: none; box-shadow: none; }`}</style>
        <ReactFlow
          nodes={nodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          className="notebookflow-canvas"
          style={FLOW_STYLE}
          onConnect={handleConnect}
          isValidConnection={isValidConnection}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          onEdgesDelete={handleEdgesDelete}
          nodesDraggable={false}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <MeasuredGroupLayout portPlacement={portPlacement} />
          <Background />
          <Controls>
            <ControlButton
              onClick={onToggleMinimap}
              title={showMinimap === true ? "Hide minimap (M)" : "Show minimap (M)"}
              aria-label="Toggle minimap"
            >
              <MapIcon size={14} />
            </ControlButton>
            <ControlButton
              onClick={() => {
                setLayout((current) => (current === "manual" ? "dagre" : "manual"));
              }}
              title={`Layout: ${layout} — click to switch to ${
                layout === "manual" ? "horizontal" : "vertical"
              }`}
              aria-label="Toggle layout"
            >
              <Network size={14} />
            </ControlButton>
          </Controls>
          {showMinimap === true && (
            <MiniMap
              nodeColor={miniMapNodeColor}
              nodeStrokeWidth={2}
              pannable
              zoomable
              position="bottom-right"
              ariaLabel="Canvas minimap"
              className="!rounded-md !border !bg-card"
            />
          )}
          <Panel position="top-left">
            <CanvasBreadcrumbs graph={graph} />
          </Panel>
          {runSummary !== undefined && runSummary !== null && (
            <Panel position="bottom-center">
              <RunSummaryOverlay summary={runSummary} />
            </Panel>
          )}
        </ReactFlow>
      </div>
    </InsertDropContext.Provider>
  );
}

function MeasuredGroupLayout({ portPlacement }: { portPlacement: PortPlacement }): null {
  const initialized = useNodesInitialized();
  const store = useStoreApi();
  const { getNodes, setNodes } = useReactFlow();
  const horizontalCells = portPlacement === "sides";

  const measureSignature = useStore((state) => {
    const parts: string[] = [];
    state.nodeInternals.forEach((internal, id) => {
      if (internal.type !== "notebook") {
        return;
      }
      parts.push(
        `${id}:${String(Math.round(internal.width ?? 0))}:${String(Math.round(internal.height ?? 0))}`,
      );
    });
    parts.sort();
    return parts.join("|");
  });

  const fallbackSize = useCallback(
    (node: Node): MeasuredSize => {
      const data = node.data as NotebookNodeData;
      const hints: NodeLayoutHints = {
        portsEditable: data.onInputsChange !== undefined || data.onOutputsChange !== undefined,
        hasMeta:
          (data.meta?.filename !== undefined && data.meta.filename !== "") ||
          (data.meta?.rows !== undefined && Number.isFinite(data.meta.rows)) ||
          (data.unresolvedInputs !== undefined && data.unresolvedInputs.length > 0),
      };
      return {
        width: estimateNodeWidth(data, portPlacement, hints),
        height: estimateNodeHeight(data, portPlacement, hints),
      };
    },
    [portPlacement],
  );

  useLayoutEffect(() => {
    void measureSignature;
    if (!initialized) {
      return;
    }

    const { nodeInternals } = store.getState();
    const measured = new Map<string, MeasuredSize>();
    let notebookCount = 0;

    nodeInternals.forEach((internal, id) => {
      if (internal.type !== "notebook") {
        return;
      }
      notebookCount += 1;
      const width = internal.width;
      const height = internal.height;
      if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) {
        return;
      }
      measured.set(id, { width, height });
    });

    if (notebookCount === 0 || measured.size < notebookCount) {
      return;
    }

    const current = getNodes();
    const next = applyMeasuredGroupLayout(
      current,
      measured,
      horizontalCells,
      GROUP_LAYOUT,
      fallbackSize,
    );

    if (measuredLayoutDiffers(current, next)) {
      setNodes(next);
    }
  }, [initialized, measureSignature, horizontalCells, store, getNodes, setNodes, fallbackSize]);

  return null;
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
    metaByNode: CanvasProps["metaByNode"];
    unresolvedByNode: CanvasProps["unresolvedByNode"];
    portPlacement: PortPlacement;
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
    metaByNode,
    unresolvedByNode,
    portPlacement,
  } = callbacks;
  const vars = variablesByNode ?? {};
  const runtime = runtimeByNode ?? {};
  const timing = timingByNode ?? {};
  const metas = metaByNode ?? {};
  const unresolved = unresolvedByNode ?? {};
  const rfNodes: Node[] = [];
  const groupIds = Object.keys(graph.groups).sort();
  let nextGroupX = 0;
  let nextGroupY = 0;
  const horizontalCells = portPlacement === "sides";

  for (let columnIdx = 0; columnIdx < groupIds.length; columnIdx++) {
    const groupId = groupIds[columnIdx];
    if (groupId === undefined) {
      continue;
    }
    const group = graph.groups[groupId];
    if (group === undefined) {
      continue;
    }

    const groupX = horizontalCells ? 0 : nextGroupX;
    const groupY = horizontalCells ? nextGroupY : GROUP_Y;
    const groupData: NodeGroupData = { ...group };
    if (onGroupToggle !== undefined) {
      groupData.onToggle = onGroupToggle;
    }

    const groupNodes = group.nodeIds
      .map((id) => graph.nodes[id])
      .filter((n): n is NodeModel => n !== undefined)
      .sort((a, b) => (a.cellIndices[0] ?? 0) - (b.cellIndices[0] ?? 0));

    type CellLayout = {
      node: NodeModel;
      hints: NodeLayoutHints;
      width: number;
      height: number;
    };
    const cellLayouts: CellLayout[] = groupNodes.map((node) => {
      const meta = metas[node.id];
      const unresolvedRefs = unresolved[node.id];
      const hints = layoutHintsForNode(node, meta, unresolvedRefs, onInputsChange, onOutputsChange);
      return {
        node,
        hints,
        width: estimateNodeWidth(node, portPlacement, hints),
        height: estimateNodeHeight(node, portPlacement, hints),
      };
    });

    let groupWidth = COLUMN_WIDTH;
    let expandedGroupHeight =
      NODE_GROUP_HEADER_HEIGHT + GROUP_INNER_TOP_PADDING + GROUP_INNER_BOTTOM_PADDING;

    if (horizontalCells) {
      const cellWidths = cellLayouts.map((cell) => cell.width);
      let maxCellHeight = 0;
      for (const cell of cellLayouts) {
        maxCellHeight = Math.max(maxCellHeight, cell.height);
      }
      groupWidth = horizontalGroupWidth(cellWidths, GROUP_LAYOUT);
      expandedGroupHeight =
        NODE_GROUP_HEADER_HEIGHT +
        GROUP_INNER_TOP_PADDING +
        maxCellHeight +
        GROUP_INNER_BOTTOM_PADDING;
    } else {
      let maxCellWidth = 0;
      let stackedContentHeight = GROUP_INNER_TOP_PADDING;
      for (const cell of cellLayouts) {
        maxCellWidth = Math.max(maxCellWidth, cell.width);
        stackedContentHeight += cell.height + NODE_GAP;
      }
      if (cellLayouts.length > 0) {
        stackedContentHeight -= NODE_GAP;
      }
      groupWidth = stackedGroupWidth(maxCellWidth, GROUP_LAYOUT);
      expandedGroupHeight =
        NODE_GROUP_HEADER_HEIGHT + stackedContentHeight + GROUP_INNER_BOTTOM_PADDING;
    }

    const groupHeight = group.collapsed ? COLLAPSED_GROUP_HEIGHT : expandedGroupHeight;

    const groupNodeId = `group:${group.id}`;
    rfNodes.push({
      id: groupNodeId,
      type: "group",
      position: { x: groupX, y: groupY },
      data: groupData,
      draggable: false,
      selectable: true,
      style: { width: groupWidth, height: groupHeight },
    });

    if (horizontalCells) {
      nextGroupY += groupHeight + COLUMN_GAP;
    } else {
      nextGroupX += groupWidth + COLUMN_GAP;
    }

    if (group.collapsed) {
      continue;
    }

    let stackedX = NODE_X_INSET;
    let stackedY = NODE_GROUP_HEADER_HEIGHT + GROUP_INNER_TOP_PADDING;
    let maxCellHeight = 0;
    for (const cell of cellLayouts) {
      maxCellHeight = Math.max(maxCellHeight, cell.height);
    }
    const slotInnerWidth = Math.max(
      groupWidth - NODE_X_INSET - GROUP_INNER_RIGHT_PADDING,
      NODE_GAP,
    );
    const slotOrientation = horizontalCells ? "horizontal" : "vertical";

    for (const cell of cellLayouts) {
      const node = cell.node;
      const nodeData: NotebookNodeData = {
        ...node,
        runtimeState: runtime[node.id] ?? "idle",
      };
      const duration = timing[node.id];
      if (duration !== undefined) {
        nodeData.runtimeDurationMs = duration;
      }
      const meta = metas[node.id];
      if (meta !== undefined) {
        nodeData.meta = meta;
      }
      const unresolvedRefs = unresolved[node.id];
      if (unresolvedRefs !== undefined && unresolvedRefs.length > 0) {
        nodeData.unresolvedInputs = unresolvedRefs;
      }
      if (onRename !== undefined) {
        nodeData.onRename = onRename;
      }
      nodeData.inputSuggestions = collectInputRefs(graph, vars, node.id);
      nodeData.outputSuggestions = collectOutputSuggestions(node, vars);
      if (onInputsChange !== undefined) {
        nodeData.onInputsChange = onInputsChange;
      }
      if (onOutputsChange !== undefined) {
        nodeData.onOutputsChange = onOutputsChange;
      }
      nodeData.portPlacement = portPlacement;
      const childX = horizontalCells ? stackedX : NODE_X_INSET;
      const childY = stackedY;
      rfNodes.push({
        id: node.id,
        type: "notebook",
        parentNode: groupNodeId,
        extent: "parent",
        position: { x: childX, y: childY },
        data: nodeData,
        draggable: false,
        selectable: true,
      });

      const afterCellIndex = node.cellIndices[0] ?? 0;
      const slotData: InsertSlotData = {
        groupId: group.id,
        afterCellIndex,
        orientation: slotOrientation,
      };
      if (horizontalCells) {
        rfNodes.push({
          id: insertSlotId(group.id, afterCellIndex),
          type: "insertSlot",
          parentNode: groupNodeId,
          extent: "parent",
          position: { x: stackedX + cell.width, y: childY },
          data: slotData,
          draggable: false,
          selectable: false,
          focusable: false,
          zIndex: 5,
          style: { width: NODE_GAP, height: maxCellHeight },
        });
        stackedX += cell.width + NODE_GAP;
      } else {
        rfNodes.push({
          id: insertSlotId(group.id, afterCellIndex),
          type: "insertSlot",
          parentNode: groupNodeId,
          extent: "parent",
          position: { x: NODE_X_INSET, y: stackedY + cell.height },
          data: slotData,
          draggable: false,
          selectable: false,
          focusable: false,
          zIndex: 5,
          style: { width: slotInnerWidth, height: NODE_GAP },
        });
        stackedY += cell.height + NODE_GAP;
      }
    }
  }

  return rfNodes;
}

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
  const groupCount = Object.keys(graph.groups).length;
  // useStore reads from React Flow's internal store; transform = [tx, ty, zoom]
  const zoom = useStore((state) => state.transform[2]);
  const zoomPct = `${String(Math.round(zoom * 100))}%`;
  return (
    <div role="img" aria-label="Canvas summary" style={BREADCRUMBS_STYLE}>
      <span>{nodeCount === 1 ? "1 node" : `${String(nodeCount)} nodes`}</span>
      {groupCount > 1 && <span>· {String(groupCount)} notebooks</span>}
      <span title="Use ⌘/Ctrl + wheel to zoom">· {zoomPct}</span>
    </div>
  );
}

function layoutHintsForNode(
  _node: NodeModel,
  meta: { filename?: string; rows?: number } | undefined,
  unresolvedRefs: string[] | undefined,
  onInputsChange: CanvasProps["onInputsChange"],
  onOutputsChange: CanvasProps["onOutputsChange"],
): NodeLayoutHints {
  const hasMetaFilename = meta?.filename !== undefined && meta.filename !== "";
  const hasMetaRows = meta?.rows !== undefined && Number.isFinite(meta.rows);
  return {
    portsEditable: onInputsChange !== undefined || onOutputsChange !== undefined,
    hasMeta:
      hasMetaFilename || hasMetaRows || (unresolvedRefs !== undefined && unresolvedRefs.length > 0),
  };
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
      zIndex: WIRE_LAYER_Z_INDEX,
      data: { crossNotebook: sourceNode.groupId !== targetNode.groupId },
    });
  }
  return edges;
}
