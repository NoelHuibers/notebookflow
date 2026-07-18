/**
 * i18n for the shared canvas. graph-canvas can't depend on any one host's i18n
 * (it's consumed by the web app, VS Code, and JupyterLab), so instead every
 * user-facing string is a **label** with an English default. A host overrides
 * them by passing `labels` to <Canvas> (canvas-internal strings) or to
 * <NodeConfigEditor> (that panel is host-rendered, outside <Canvas>).
 *
 * The context default IS the English label set, so components rendered without a
 * provider (e.g. in unit tests) still get the exact English strings.
 */
import { createContext, type Provider, useContext } from "react";

export interface CanvasLabels {
  // Toolbar
  minimapShow: string;
  minimapHide: string;
  minimapToggle: string;
  minimapAria: string;
  layoutToggle: string;
  layoutSwitchTo: string; // "Switch to {target}" — {target} = layoutHorizontal|layoutVertical
  layoutHorizontal: string;
  layoutVertical: string;
  // Run summary overlay
  runSummaryAria: string;
  statusCompleted: string;
  statusPartial: string;
  statusFailed: string;
  statusNoNodes: string;
  // Breadcrumbs
  canvasSummaryAria: string;
  nodeCountOne: string; // "{count} node"
  nodeCountOther: string; // "{count} nodes"
  notebookCountOther: string; // "{count} notebooks"
  zoomHint: string;
  // Node
  nodeNameAria: string;
  renameHint: string;
  renameNode: string;
  nodeMetaTitle: string;
  statusTitle: string; // "Status: {status}" — {status} = one of the runtime status labels
  lastRunTitle: string; // "Last run: {duration}"
  unresolvedRefsTitle: string; // "Unresolved input refs:\n{refs}"
  unresolvedShort: string; // "unresolved: {refs}"
  // Node runtime status badges
  statusIdle: string;
  statusQueued: string;
  statusRunning: string;
  statusOk: string;
  statusError: string;
  statusSkipped: string;
  // Node tag chips
  tagInput: string;
  tagTransform: string;
  tagOutput: string;
  tagAi: string;
  tagIo: string;
  // Ports
  portInput: string;
  portOutput: string;
  addInput: string;
  addOutput: string;
  portClickToEdit: string;
  removePort: string; // "Remove {port}"
  portSourceAria: string;
  portVariableAria: string;
  // Node group (notebook container)
  expandNotebook: string;
  collapseNotebook: string;
}

export interface NodeConfigLabels {
  title: string;
  subtitle: string;
  generateNode: string;
  applyConfig: string;
  updating: string;
  upToDate: string;
}

// English defaults. These MUST match the strings the component tests assert
// (e.g. "Rename node", "Node name", "Collapse notebook", "Add input").
export const defaultCanvasLabels: CanvasLabels = {
  minimapShow: "Show minimap (M)",
  minimapHide: "Hide minimap (M)",
  minimapToggle: "Toggle minimap",
  minimapAria: "Canvas minimap",
  layoutToggle: "Toggle layout",
  layoutSwitchTo: "Switch to {target}",
  layoutHorizontal: "horizontal",
  layoutVertical: "vertical",
  runSummaryAria: "Last run summary",
  statusCompleted: "completed",
  statusPartial: "partial",
  statusFailed: "failed",
  statusNoNodes: "no nodes",
  canvasSummaryAria: "Canvas summary",
  nodeCountOne: "{count} node",
  nodeCountOther: "{count} nodes",
  notebookCountOther: "{count} notebooks",
  zoomHint: "Use ⌘/Ctrl + wheel to zoom",
  nodeNameAria: "Node name",
  renameHint: "Double-click to rename",
  renameNode: "Rename node",
  nodeMetaTitle: "Input file · output rows",
  statusTitle: "Status: {status}",
  lastRunTitle: "Last run: {duration}",
  unresolvedRefsTitle: "Unresolved input refs:\n{refs}",
  unresolvedShort: "unresolved: {refs}",
  statusIdle: "idle",
  statusQueued: "queued",
  statusRunning: "running",
  statusOk: "ok",
  statusError: "error",
  statusSkipped: "skipped",
  tagInput: "input",
  tagTransform: "transform",
  tagOutput: "output",
  tagAi: "ai",
  tagIo: "io",
  portInput: "Input",
  portOutput: "Output",
  addInput: "Add input",
  addOutput: "Add output",
  portClickToEdit: "Click to edit",
  removePort: "Remove {port}",
  portSourceAria: "Input source",
  portVariableAria: "Output variable",
  expandNotebook: "Expand notebook",
  collapseNotebook: "Collapse notebook",
};

export const defaultNodeConfigLabels: NodeConfigLabels = {
  title: "Config",
  subtitle: "Managed separately from the node's input and output ports.",
  generateNode: "Generate node",
  applyConfig: "Apply config",
  updating: "Updating…",
  upToDate: "Up to date",
};

const CanvasLabelsContext = createContext<CanvasLabels>(defaultCanvasLabels);
export const CanvasLabelsProvider: Provider<CanvasLabels> = CanvasLabelsContext.Provider;

/** Canvas-internal components read their strings here; defaults to English. */
export function useCanvasLabels(): CanvasLabels {
  return useContext(CanvasLabelsContext);
}

/** Merge a host's partial overrides over the English defaults. */
export function mergeCanvasLabels(overrides?: Partial<CanvasLabels>): CanvasLabels {
  return overrides ? { ...defaultCanvasLabels, ...overrides } : defaultCanvasLabels;
}

export function mergeNodeConfigLabels(overrides?: Partial<NodeConfigLabels>): NodeConfigLabels {
  return overrides ? { ...defaultNodeConfigLabels, ...overrides } : defaultNodeConfigLabels;
}
