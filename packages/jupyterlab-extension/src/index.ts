/**
 * JupyterLab platform adapter — extension entry point.
 *
 * Registers the ``notebookflow:open-canvas`` command that opens a
 * SplitView next to the active notebook. The shared NotebookFlow Canvas
 * lives inside the SplitView and talks to the engine over WebSocket
 * (assumed reachable at ws://127.0.0.1:8765/ws for now — Phase 5d skips
 * the jupyter-server-proxy auto-launch in favour of a manual engine start;
 * follow-up work will introduce the server-extension shim).
 *
 * Discoverability surfaces:
 *   - Command palette (NotebookFlow: Open Canvas)
 *   - Per-notebook toolbar button (this extension registers a widget
 *     extension on the Notebook DocumentRegistry so every open .ipynb
 *     gets a clickable button to the right of Run/Restart).
 */

import type { JupyterFrontEnd, JupyterFrontEndPlugin } from "@jupyterlab/application";
import { ICommandPalette, ToolbarButton } from "@jupyterlab/apputils";
import type { INotebookTracker, NotebookPanel } from "@jupyterlab/notebook";
import { INotebookTracker as NotebookTrackerToken } from "@jupyterlab/notebook";
import type { IDisposable } from "@lumino/disposable";
import { DisposableDelegate } from "@lumino/disposable";

import { SplitView } from "./SplitView";

const COMMAND_ID = "notebookflow:open-canvas";
const CATEGORY = "NotebookFlow";

class OpenCanvasButtonExtension {
  private readonly app: JupyterFrontEnd;

  constructor(app: JupyterFrontEnd) {
    this.app = app;
  }

  createNew(panel: NotebookPanel): IDisposable {
    const button = new ToolbarButton({
      label: "NotebookFlow",
      tooltip: "Open the NotebookFlow canvas next to this notebook",
      iconClass: "jp-Icon jp-Icon-16",
      onClick: (): void => {
        void this.app.commands.execute(COMMAND_ID);
      },
    });
    // Slot 11 puts us right after Run/Restart/etc. in the JL 4 notebook toolbar.
    panel.toolbar.insertItem(11, "notebookflow:open-canvas", button);
    return new DisposableDelegate(() => {
      button.dispose();
    });
  }
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: "@notebookflow/jupyterlab-extension:plugin",
  autoStart: true,
  requires: [NotebookTrackerToken, ICommandPalette],
  activate: (app: JupyterFrontEnd, tracker: INotebookTracker, palette: ICommandPalette): void => {
    app.commands.addCommand(COMMAND_ID, {
      label: "NotebookFlow: Open Canvas",
      caption: "Open the NotebookFlow canvas alongside the active notebook.",
      isEnabled: () => tracker.currentWidget !== null,
      execute: () => {
        const panel = tracker.currentWidget;
        if (panel === null) {
          return;
        }
        const widget = new SplitView(panel);
        app.shell.add(widget, "main", { mode: "split-right" });
        app.shell.activateById(widget.id);
      },
    });

    palette.addItem({ command: COMMAND_ID, category: CATEGORY });

    // Per-notebook toolbar button — the button the user asked for.
    app.docRegistry.addWidgetExtension("Notebook", new OpenCanvasButtonExtension(app));
  },
};

export default plugin;
