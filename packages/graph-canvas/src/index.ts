/**
 * @notebookflow/graph-canvas
 *
 * Public entry point for the shared graph canvas component. All platform
 * adapters (JupyterLab, VS Code, web app) consume the canvas through this
 * module so that visual behavior stays consistent across platforms.
 */

export type { PaneDropTarget } from "./components/Canvas";
export { Canvas } from "./components/Canvas";
export { NotebookNode } from "./components/Node";
export { NodeConfigEditor } from "./components/NodeConfigEditor";
export { NodeGroup } from "./components/NodeGroup";
export { NODE_DRAG_MIME } from "./components/nodeDragMime";
export {
  isPaletteDrag,
  readPaletteDragManifestId,
  setPaletteDragData,
} from "./components/paletteDragData";
export { Wire } from "./components/Wire";
export type {
  NodeConfigFieldDef,
  NodeConfigFieldKind,
  NodeConfigOptionDef,
  NodeGenerationMode,
  NodeManifestDef,
  NodePortDef,
  NodeSynthesisRequest,
  NodeSynthesisResponse,
  NotebookflowNodeMetadata,
} from "./node-config";
export {
  configValuesEqual,
  defaultConfigForManifest,
  hasMissingRequiredConfig,
  readNotebookflowMetadata,
  resolveNodeConfig,
  sanitizeConfigForManifest,
  writeNotebookflowMetadata,
} from "./node-config";
export * as sync from "./sync";
export type {
  GraphModel,
  NodeGroupModel,
  NodeMarker,
  NodeModel,
  NodeTag,
  RunSummary,
  RuntimeState,
  WireModel,
} from "./types";
