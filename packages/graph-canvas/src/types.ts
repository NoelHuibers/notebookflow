/**
 * Shared graph-model types.
 *
 * The graph is *derived* from the notebook(s); these types are the in-memory
 * shape used by the canvas and the sync engine. They mirror what gets
 * encoded in `# @node` markers inside notebook cells.
 */

export type NodeTag = "input" | "transform" | "output" | "ai" | "io";

/** A single `# @node` marker as parsed from a notebook cell. */
export interface NodeMarker {
  /** Node display name from the marker. */
  name: string;
  /** Tag classifying the node's role. */
  tag: NodeTag;
  /** Declared input port names. */
  inputs: string[];
  /** Declared output port names. */
  outputs: string[];
  /** Source notebook path. */
  notebookPath: string;
  /** Index of the cell carrying the marker. */
  cellIndex: number;
}

/** A node = a contiguous group of cells in a notebook. */
export interface NodeModel {
  id: string;
  name: string;
  tag: NodeTag;
  inputs: string[];
  outputs: string[];
  /** Notebook-native cell metadata carried by this node's first cell. */
  metadata?: Record<string, unknown>;
  /** Cell indices that make up this node, in notebook order. */
  cellIndices: number[];
  /** The notebook (NodeGroup) this node belongs to. */
  groupId: string;
}

/** A NodeGroup = a full notebook containing 0..N nodes. */
export interface NodeGroupModel {
  id: string;
  notebookPath: string;
  /** Display name (usually the notebook filename). */
  name: string;
  /** Node ids contained in this group. */
  nodeIds: string[];
  /** Whether the group is rendered collapsed on the canvas. */
  collapsed: boolean;
}

/** A directed connection between two ports. May span notebooks. */
export interface WireModel {
  id: string;
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
}

/** Top-level graph state. */
export interface GraphModel {
  nodes: Record<string, NodeModel>;
  groups: Record<string, NodeGroupModel>;
  wires: Record<string, WireModel>;
}
