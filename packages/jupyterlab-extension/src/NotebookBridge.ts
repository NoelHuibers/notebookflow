/**
 * NotebookBridge — adapter over a JupyterLab ``NotebookPanel``.
 *
 * Reads the notebook's cell list into the platform-neutral ``NotebookCell``
 * shape the SyncEngine consumes, applies cell-source patches back, and
 * fires a ``changed`` signal whenever the notebook model mutates so the
 * SyncEngine can re-ingest on save / edit / cell add.
 */

import type * as nbformat from "@jupyterlab/nbformat";
import type { NotebookPanel } from "@jupyterlab/notebook";
import type { IDisposable } from "@lumino/disposable";
import { Signal } from "@lumino/signaling";
import type { NbOutput } from "@notebookflow/app-core";
import type { CellPatch, NotebookCell } from "@notebookflow/graph-canvas/sync";

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
        metadata: cell.sharedModel.getMetadata(),
      });
    }
    return cells;
  }

  applyPatch(patch: CellPatch): void {
    const model = this.panel.model;
    if (model === null) {
      throw new Error("NotebookBridge.applyPatch: notebook has no model");
    }

    if (patch.operation === "insert") {
      if (patch.newSource === null || patch.cellIndex < 0 || patch.cellIndex > model.cells.length) {
        throw new Error(
          `NotebookBridge.applyPatch: insert cellIndex ${String(patch.cellIndex)} out of range`,
        );
      }
      model.sharedModel.insertCell(patch.cellIndex, {
        cell_type: toNbformatCellType(patch.cellType ?? "code"),
        source: patch.newSource,
        metadata: toNbformatMetadata(patch.metadata),
      });
      return;
    }

    if (patch.cellIndex < 0 || patch.cellIndex >= model.cells.length) {
      throw new Error(
        `NotebookBridge.applyPatch: cellIndex ${String(patch.cellIndex)} out of range`,
      );
    }

    if (patch.operation === "delete" || patch.newSource === null) {
      model.sharedModel.deleteCell(patch.cellIndex);
      return;
    }

    const cell = model.cells.get(patch.cellIndex);
    cell.sharedModel.setSource(patch.newSource);
    if (patch.metadata !== undefined) {
      cell.sharedModel.setMetadata(toNbformatMetadata(patch.metadata));
    }
  }

  clearOutputs(cellIndices: number[]): void {
    const model = this.panel.model;
    if (model === null) {
      throw new Error("NotebookBridge.clearOutputs: notebook has no model");
    }
    for (const cellIndex of uniqueCellIndices(cellIndices)) {
      const codeCell = this.codeCellSharedModelAt(cellIndex);
      if (codeCell === null) {
        continue;
      }
      codeCell.execution_count = null;
      codeCell.setOutputs([]);
    }
  }

  replaceOutputs(cellIndex: number, outputs: NbOutput[], executionCount: number | null): void {
    const codeCell = this.codeCellSharedModelAt(cellIndex);
    if (codeCell === null) {
      return;
    }
    codeCell.execution_count = executionCount;
    codeCell.setOutputs(outputs.map((output) => toNbformatOutput(output, executionCount)));
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

  private codeCellSharedModelAt(cellIndex: number): CodeCellSharedModel | null {
    const model = this.panel.model;
    if (model === null) {
      throw new Error("NotebookBridge.codeCellSharedModelAt: notebook has no model");
    }
    if (cellIndex < 0 || cellIndex >= model.cells.length) {
      throw new Error(
        `NotebookBridge.codeCellSharedModelAt: cellIndex ${String(cellIndex)} out of range`,
      );
    }
    const cell = model.cells.get(cellIndex);
    if (cell.type !== "code") {
      return null;
    }
    return cell.sharedModel as CodeCellSharedModel;
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

function toNbformatCellType(kind: NotebookCell["cellType"]): string {
  if (kind === "markdown") {
    return "markdown";
  }
  if (kind === "raw") {
    return "raw";
  }
  return "code";
}

function toNbformatMetadata(
  metadata: Record<string, unknown> | undefined,
):
  | Partial<nbformat.ICellMetadata>
  | Partial<nbformat.ICodeCellMetadata>
  | Partial<nbformat.IRawCellMetadata> {
  return (metadata ?? {}) as
    | Partial<nbformat.ICellMetadata>
    | Partial<nbformat.ICodeCellMetadata>
    | Partial<nbformat.IRawCellMetadata>;
}

interface CodeCellSharedModel {
  execution_count: nbformat.ExecutionCount;
  setOutputs(outputs: nbformat.IOutput[]): void;
  setMetadata(
    metadata:
      | Partial<nbformat.ICellMetadata>
      | Partial<nbformat.ICodeCellMetadata>
      | Partial<nbformat.IRawCellMetadata>,
  ): void;
}

function uniqueCellIndices(cellIndices: number[]): number[] {
  return Array.from(new Set(cellIndices)).sort((left, right) => left - right);
}

function toNbformatOutput(
  output: NbOutput,
  executionCount: nbformat.ExecutionCount,
): nbformat.IOutput {
  switch (output.output_type) {
    case "stream":
      return output;
    case "display_data":
      return {
        ...output,
        metadata: output.metadata as nbformat.OutputMetadata,
      };
    case "execute_result":
      return {
        ...output,
        execution_count: executionCount,
        metadata: output.metadata as nbformat.OutputMetadata,
      };
    case "error":
      return output;
  }
}
