/**
 * JupyterLab platform adapter — extension entry point.
 *
 * Registers the ``notebookflow:open-canvas`` command that opens a
 * SplitView next to the active notebook. The shared NotebookFlow Canvas
 * lives inside the SplitView and talks to the engine over WebSocket
 * (assumed reachable at ws://127.0.0.1:8765/ws for now — Phase 5d skips
 * the jupyter-server-proxy auto-launch in favour of a manual engine start;
 * follow-up work will introduce the server-extension shim).
 */

import type { JupyterFrontEnd, JupyterFrontEndPlugin } from "@jupyterlab/application";
import { ICommandPalette } from "@jupyterlab/apputils";
import type { INotebookTracker } from "@jupyterlab/notebook";
import { INotebookTracker as NotebookTrackerToken } from "@jupyterlab/notebook";

import { SplitView } from "./SplitView";

const COMMAND_ID = "notebookflow:open-canvas";
const CATEGORY = "NotebookFlow";

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
  },
};

export default plugin;
