/**
 * @notebookflow/graph-canvas
 *
 * Public entry point for the shared graph canvas component. All platform
 * adapters (JupyterLab, VS Code, web app) consume the canvas through this
 * module so that visual behavior stays consistent across platforms.
 */

export { Canvas } from "./components/Canvas";
export { NotebookNode } from "./components/Node";
export { NodeGroup } from "./components/NodeGroup";
export { Wire } from "./components/Wire";
export * as sync from "./sync";
export type {
  GraphModel,
  NodeGroupModel,
  NodeMarker,
  NodeModel,
  NodeTag,
  WireModel,
} from "./types";
