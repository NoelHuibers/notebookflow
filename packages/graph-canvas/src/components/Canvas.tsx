/**
 * Canvas — top-level React Flow surface.
 *
 * Renders the full graph: NodeGroups (notebooks) as collapsible containers,
 * NotebookNodes inside them, and Wires between ports. This component is
 * platform-agnostic — JupyterLab, VS Code, and the standalone web app all
 * mount the same Canvas and pass in their own graph data and event handlers.
 */

import type { ReactElement } from "react";
import type { GraphModel, NodeModel, WireModel } from "../types";

export interface CanvasProps {
  graph: GraphModel;
  onNodeRename?: (nodeId: string, nextName: string) => void;
  onWireCreate?: (wire: Omit<WireModel, "id">) => void;
  onWireDelete?: (wireId: string) => void;
  onNodeSelect?: (node: NodeModel | null) => void;
  onGroupToggle?: (groupId: string) => void;
}

export function Canvas(_props: CanvasProps): ReactElement {
  // TODO: wire up React Flow with custom node/edge types from
  //   ./Node, ./NodeGroup, ./Wire. Translate GraphModel ↔ React Flow
  //   nodes/edges. Forward edits to the props callbacks.
  throw new Error("Canvas: not implemented");
}
