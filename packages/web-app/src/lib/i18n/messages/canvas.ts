// `canvas` namespace — labels handed to the shared graph-canvas package
// (@notebookflow/graph-canvas) via <Canvas labels> and <NodeConfigEditor labels>.
// Both label sets (EN defaults + DE) ship with graph-canvas itself; this module
// just flattens CanvasLabels + NodeConfigLabels into one namespace, renaming
// the NodeConfigLabels fields to config* (CanvasSidebar splits them back out).
// `{count}`/`{target}` are filled by graph-canvas (simple string replace), not
// react-i18next.
import {
  deCanvasLabels,
  defaultCanvasLabels,
  defaultNodeConfigLabels,
  deNodeConfigLabels,
} from "@notebookflow/graph-canvas";

export const en = {
  ...defaultCanvasLabels,
  // NodeConfigEditor (host-rendered in the sidebar)
  configTitle: defaultNodeConfigLabels.title,
  configSubtitle: defaultNodeConfigLabels.subtitle,
  configGenerate: defaultNodeConfigLabels.generateNode,
  configApply: defaultNodeConfigLabels.applyConfig,
  configUpdating: defaultNodeConfigLabels.updating,
  configUpToDate: defaultNodeConfigLabels.upToDate,
};

export const de: typeof en = {
  ...deCanvasLabels,
  configTitle: deNodeConfigLabels.title,
  configSubtitle: deNodeConfigLabels.subtitle,
  configGenerate: deNodeConfigLabels.generateNode,
  configApply: deNodeConfigLabels.applyConfig,
  configUpdating: deNodeConfigLabels.updating,
  configUpToDate: deNodeConfigLabels.upToDate,
};
