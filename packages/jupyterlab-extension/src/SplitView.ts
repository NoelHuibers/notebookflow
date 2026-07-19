/**
 * SplitView — Lumino widget that hosts the NotebookFlow React surface.
 *
 * JupyterLab's ``ReactWidget`` from ``@jupyterlab/apputils`` handles the
 * React mount/unmount lifecycle for us; this class just wires a fresh
 * NotebookBridge + EngineClient pair into the App component and sets the
 * shell-side metadata Lumino needs (icon, title, id).
 *
 * The engine client is the shared app-core EngineClient. Its URL resolves
 * through jupyter-server-proxy (or the ``engineUrlOverride`` setting), and the
 * BYOK credentials from the plugin settings are applied on construction and
 * re-applied whenever the settings change.
 */

import { ReactWidget } from "@jupyterlab/apputils";
import type { NotebookPanel } from "@jupyterlab/notebook";
import type { Contents } from "@jupyterlab/services";
import type {
  AskAnswer,
  DataFile,
  EngineEvent,
  PipelineDef,
  PipelineExplanation,
  PipelineProposal,
} from "@notebookflow/app-core";
import { EngineClient } from "@notebookflow/app-core";
import type { NodeManifestDef } from "@notebookflow/graph-canvas";
import type { ReactElement } from "react";
import { createElement } from "react";

import { App } from "./App";
import {
  deleteNotebookDataFile,
  listNotebookDataFiles,
  notebookDirname,
  uploadNotebookDataFile,
} from "./dataFiles";
import { resolveEngineUrl } from "./engineUrl";
import { KernelBridge } from "./KernelBridge";
import { NotebookBridge } from "./NotebookBridge";
import type { SettingsAccessor } from "./settings";

let widgetCounter = 0;

export class SplitView extends ReactWidget {
  private readonly panel: NotebookPanel;
  private readonly bridge: NotebookBridge;
  private readonly kernel: KernelBridge;
  private readonly contents: Contents.IManager;
  /** Plugin settings seam (BYOK credentials + engine URL override). */
  readonly settings: SettingsAccessor;
  private engineClient: EngineClient;
  private engineUrl: string;
  private readonly unsubscribeSettings: () => void;

  constructor(panel: NotebookPanel, settings: SettingsAccessor, contents: Contents.IManager) {
    super();
    widgetCounter += 1;
    this.id = `notebookflow-split-${String(widgetCounter)}`;
    this.title.label = `NotebookFlow: ${panel.context.path.split("/").pop() ?? "notebook"}`;
    this.title.closable = true;
    this.addClass("notebookflow-split-view");

    this.panel = panel;
    this.settings = settings;
    this.contents = contents;
    this.bridge = new NotebookBridge(panel);
    this.engineUrl = resolveEngineUrl(settings.get().engineUrlOverride);
    this.engineClient = new EngineClient(this.engineUrl);
    this.applyCredentials();
    this.unsubscribeSettings = settings.subscribe(() => {
      this.refreshEngine();
    });
    // Resolve fresh on each call: the active kernel can change (restart,
    // shutdown, swap) over the lifetime of the SplitView.
    this.kernel = new KernelBridge((): ReturnType<typeof this.activeKernel> => this.activeKernel());

    panel.disposed.connect(() => {
      this.dispose();
    });
  }

  /** The current engine client (recreated when the URL override changes). */
  private get engine(): EngineClient {
    return this.engineClient;
  }

  /** Re-resolve the engine URL and re-apply BYOK credentials from settings. */
  private refreshEngine(): void {
    const url = resolveEngineUrl(this.settings.get().engineUrlOverride);
    if (url !== this.engineUrl) {
      this.engineUrl = url;
      this.engineClient = new EngineClient(url);
    }
    this.applyCredentials();
  }

  private applyCredentials(): void {
    const { llmProvider, llmModel, llmApiKey } = this.settings.get();
    this.engineClient.setCredentials(
      llmApiKey.trim() === ""
        ? null
        : { provider: llmProvider, model: llmModel, apiKey: llmApiKey },
    );
  }

  /** The Contents-API directory the notebook lives in ("" = server root). */
  private get notebookDir(): string {
    return notebookDirname(this.panel.context.path);
  }

  // Data files follow the execution path: the kernel runs with the notebook's
  // directory as cwd, so kernel-path uploads go to the notebook's directory
  // via the Jupyter Contents API; the engine's /files dir is only reachable
  // by engine-path runs and is used as the fallback.
  private listDataFiles(): Promise<DataFile[]> {
    if (this.kernel.isReady) {
      return listNotebookDataFiles(this.contents, this.notebookDir);
    }
    return this.engine.listDataFiles();
  }

  private async uploadDataFile(file: File): Promise<void> {
    if (this.kernel.isReady) {
      await uploadNotebookDataFile(this.contents, this.notebookDir, file);
      return;
    }
    await this.engine.uploadDataFile(file);
  }

  private async deleteDataFile(name: string): Promise<void> {
    if (this.kernel.isReady) {
      await deleteNotebookDataFile(this.contents, this.notebookDir, name);
      return;
    }
    await this.engine.deleteDataFile(name);
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
      onAsk: (prompt: string, pipeline?: PipelineDef): Promise<AskAnswer> =>
        this.engine.askLLM(prompt, pipeline),
      onCompose: (prompt: string): Promise<PipelineProposal> =>
        this.engine.proposePipeline(prompt, this.bridge.notebookPath),
      onExplain: (pipeline: PipelineDef): Promise<PipelineExplanation> =>
        this.engine.explainPipeline(pipeline),
      onListDataFiles: (): Promise<DataFile[]> => this.listDataFiles(),
      onUploadDataFile: (file: File): Promise<void> => this.uploadDataFile(file),
      onDeleteDataFile: (name: string): Promise<void> => this.deleteDataFile(name),
    });
  }

  override dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.unsubscribeSettings();
    this.bridge.dispose();
    super.dispose();
  }
}
