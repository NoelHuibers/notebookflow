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
import { Background, Controls, ReactFlow } from "reactflow";

import type { GraphModel, NodeModel, WireModel } from "../types";
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
}

export function Canvas(props: CanvasProps): ReactElement {
  const { graph, onNodeRename, onWireCreate, onWireDelete, onNodeSelect, onGroupToggle } = props;

  const rfNodes = useMemo<Node[]>(
    () => buildNodes(graph, onNodeRename, onGroupToggle),
    [graph, onNodeRename, onGroupToggle],
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
    </ReactFlow>
  );
}

function buildNodes(
  graph: GraphModel,
  onRename: CanvasProps["onNodeRename"],
  onGroupToggle: CanvasProps["onGroupToggle"],
): Node[] {
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
      const nodeData: NotebookNodeData = { ...node };
      if (onRename !== undefined) {
        nodeData.onRename = onRename;
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
