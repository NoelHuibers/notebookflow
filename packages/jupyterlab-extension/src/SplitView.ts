/**
 * SplitView — Lumino widget that hosts the NotebookFlow React surface.
 *
 * JupyterLab's ``ReactWidget`` from ``@jupyterlab/apputils`` handles the
 * React mount/unmount lifecycle for us; this class just wires a fresh
 * NotebookBridge + EngineClient pair into the App component and sets the
 * shell-side metadata Lumino needs (icon, title, id).
 */

import { ReactWidget } from "@jupyterlab/apputils";
import type { NotebookPanel } from "@jupyterlab/notebook";
import type { ReactElement } from "react";
import { createElement } from "react";

import { App } from "./App";
import type { EngineEvent, NodeManifestDef, PipelineDef } from "./EngineClient";
import { EngineClient } from "./EngineClient";
import { NotebookBridge } from "./NotebookBridge";

let widgetCounter = 0;

export class SplitView extends ReactWidget {
  private readonly bridge: NotebookBridge;
  private readonly engine: EngineClient;

  constructor(panel: NotebookPanel) {
    super();
    widgetCounter += 1;
    this.id = `notebookflow-split-${String(widgetCounter)}`;
    this.title.label = `NotebookFlow: ${panel.context.path.split("/").pop() ?? "notebook"}`;
    this.title.closable = true;
    this.addClass("notebookflow-split-view");

    this.bridge = new NotebookBridge(panel);
    this.engine = new EngineClient();

    panel.disposed.connect(() => {
      this.dispose();
    });
  }

  protected override render(): ReactElement {
    return createElement(App, {
      bridge: this.bridge,
      onRun: (pipeline: PipelineDef, onEvent: (event: EngineEvent) => void): Promise<void> =>
        this.engine.runPipeline({
          pipelineId: `jupyter-${this.id}`,
          pipeline,
          onEvent,
        }),
      onListNodes: (): Promise<NodeManifestDef[]> => this.engine.listNodes(),
    });
  }

  override dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.bridge.dispose();
    super.dispose();
  }
}
