/**
 * JupyterLab platform adapter — extension entry point.
 *
 * Registers the NotebookFlow plugin: a left-panel canvas widget split
 * alongside the active notebook editor. The widget hosts the shared
 * @notebookflow/graph-canvas and bridges notebook events through
 * SplitView and KernelBridge.
 */

import type { JupyterFrontEndPlugin } from "@jupyterlab/application";

const plugin: JupyterFrontEndPlugin<void> = {
  id: "@notebookflow/jupyterlab-extension:plugin",
  autoStart: true,
  requires: [],
  activate: (): void => {
    // TODO: register the SplitView widget, hook it into INotebookTracker,
    //   open a WebSocket to the FastAPI engine via jupyter-server-proxy.
    throw new Error("jupyterlab-extension: not implemented");
  },
};

export default plugin;
