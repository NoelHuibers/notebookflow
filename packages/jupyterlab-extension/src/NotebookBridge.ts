/**
 * NotebookBridge — adapter over a JupyterLab ``NotebookPanel``.
 *
 * Reads the notebook's cell list into the platform-neutral ``NotebookCell``
 * shape the SyncEngine consumes, applies cell-source patches back, and
 * fires a ``changed`` signal whenever the notebook model mutates so the
 * SyncEngine can re-ingest on save / edit / cell add.
 */

import type { NotebookPanel } from "@jupyterlab/notebook";
import type { IDisposable } from "@lumino/disposable";
import { Signal } from "@lumino/signaling";
import type { NotebookCell } from "@notebookflow/graph-canvas/sync";

export class NotebookBridge implements IDisposable {
  private readonly panel: NotebookPanel;
  readonly changed: Signal<this, void>;
  private _isDisposed = false;

  constructor(panel: NotebookPanel) {
    this.panel = panel;
    this.changed = new Signal<this, void>(this);
    panel.model?.cells.changed.connect(this.emitChanged, this);
    panel.context.fileChanged.connect(this.emitChanged, this);
  }

  get notebookPath(): string {
    return this.panel.context.path;
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  readCells(): NotebookCell[] {
    const model = this.panel.model;
    if (model === null) {
      return [];
    }
    const cells: NotebookCell[] = [];
    for (let i = 0; i < model.cells.length; i++) {
      const cell = model.cells.get(i);
      cells.push({
        cellType: cellKind(cell.type),
        source: cell.sharedModel.getSource(),
      });
    }
    return cells;
  }

  applyPatch(cellIndex: number, newSource: string | null): void {
    const model = this.panel.model;
    if (model === null) {
      throw new Error("NotebookBridge.applyPatch: notebook has no model");
    }
    if (cellIndex < 0 || cellIndex >= model.cells.length) {
      throw new Error(`NotebookBridge.applyPatch: cellIndex ${String(cellIndex)} out of range`);
    }

    if (newSource === null) {
      model.sharedModel.deleteCell(cellIndex);
      return;
    }

    const cell = model.cells.get(cellIndex);
    cell.sharedModel.setSource(newSource);
  }

  dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    Signal.clearData(this);
    this.panel.model?.cells.changed.disconnect(this.emitChanged, this);
    this.panel.context.fileChanged.disconnect(this.emitChanged, this);
  }

  private emitChanged(): void {
    this.changed.emit(undefined);
  }
}

function cellKind(kind: string): NotebookCell["cellType"] {
  if (kind === "code") {
    return "code";
  }
  if (kind === "markdown") {
    return "markdown";
  }
  return "raw";
}
