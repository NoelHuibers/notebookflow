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
import type { NodeManifestDef } from "@notebookflow/graph-canvas";
import type { ReactElement } from "react";
import { createElement } from "react";

import { App } from "./App";
import type { EngineEvent, PipelineDef } from "./EngineClient";
import { EngineClient } from "./EngineClient";
import { KernelBridge } from "./KernelBridge";
import { NotebookBridge } from "./NotebookBridge";

let widgetCounter = 0;

export class SplitView extends ReactWidget {
  private readonly panel: NotebookPanel;
  private readonly bridge: NotebookBridge;
  private readonly engine: EngineClient;
  private readonly kernel: KernelBridge;

  constructor(panel: NotebookPanel) {
    super();
    widgetCounter += 1;
    this.id = `notebookflow-split-${String(widgetCounter)}`;
    this.title.label = `NotebookFlow: ${panel.context.path.split("/").pop() ?? "notebook"}`;
    this.title.closable = true;
    this.addClass("notebookflow-split-view");

    this.panel = panel;
    this.bridge = new NotebookBridge(panel);
    this.engine = new EngineClient();
    // Resolve fresh on each call: the active kernel can change (restart,
    // shutdown, swap) over the lifetime of the SplitView.
    this.kernel = new KernelBridge((): ReturnType<typeof this.activeKernel> => this.activeKernel());

    panel.disposed.connect(() => {
      this.dispose();
    });
  }

  private activeKernel(): NonNullable<
    NotebookPanel["sessionContext"]["session"]
  >["kernel"] extends infer K
    ? K | null
    : null {
    return (this.panel.sessionContext.session?.kernel ?? null) as never;
  }

  protected override render(): ReactElement {
    return createElement(App, {
      bridge: this.bridge,
      onRun: (pipeline: PipelineDef, onEvent: (event: EngineEvent) => void): Promise<void> => {
        // Prefer the live JL kernel when one's attached, so node code shares
        // the user's notebook namespace. Fall back to the engine WS otherwise.
        if (this.kernel.isReady) {
          return this.kernel.runPipeline({
            pipelineId: `jupyter-${this.id}`,
            pipeline,
            onEvent,
          });
        }
        return this.engine.runPipeline({
          pipelineId: `jupyter-${this.id}`,
          pipeline,
          onEvent,
        });
      },
      onListNodes: (): Promise<NodeManifestDef[]> => this.engine.listNodes(),
      onSynthesizeNode: (request) => this.engine.synthesizeNode(request),
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
