/**
 * SplitView — Lumino widget that puts the graph canvas next to the notebook.
 *
 * Owns the React mount point for @notebookflow/graph-canvas and forwards
 * notebook-tracker events into the SyncEngine.
 */

import { Widget } from "@lumino/widgets";

export class SplitView extends Widget {
  constructor() {
    super();
    // TODO: create container DOM, mount React Canvas, hook into the
    //   active notebook via INotebookTracker, instantiate SyncEngine.
  }
}
