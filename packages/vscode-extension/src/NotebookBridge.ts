/**
 * NotebookBridge — adapter over the vscode.notebooks API.
 *
 * Translates VS Code's NotebookDocument cell model into the platform-neutral
 * NotebookCell shape consumed by the SyncEngine, and applies cell patches
 * back through a WorkspaceEdit so the user's undo stack stays intact.
 */

import type { NotebookCell } from "@notebookflow/graph-canvas/sync";
import * as vscode from "vscode";

export class NotebookBridge {
  private readonly doc: vscode.NotebookDocument;

  constructor(doc: vscode.NotebookDocument) {
    this.doc = doc;
  }

  get notebookPath(): string {
    return this.doc.uri.fsPath;
  }

  get document(): vscode.NotebookDocument {
    return this.doc;
  }

  readCells(): NotebookCell[] {
    return this.doc.getCells().map((cell) => ({
      cellType: cellKind(cell.kind),
      source: cell.document.getText(),
    }));
  }

  async applyPatch(cellIndex: number, newSource: string | null): Promise<void> {
    if (cellIndex < 0 || cellIndex >= this.doc.cellCount) {
      throw new Error(`NotebookBridge.applyPatch: cellIndex ${String(cellIndex)} out of range`);
    }
    const edit = new vscode.WorkspaceEdit();

    if (newSource === null) {
      edit.set(this.doc.uri, [
        vscode.NotebookEdit.deleteCells(new vscode.NotebookRange(cellIndex, cellIndex + 1)),
      ]);
    } else {
      const cell = this.doc.cellAt(cellIndex);
      const lastLine = Math.max(0, cell.document.lineCount - 1);
      const lastChar = cell.document.lineAt(lastLine).range.end.character;
      const fullRange = new vscode.Range(0, 0, lastLine, lastChar);
      edit.replace(cell.document.uri, fullRange, newSource);
    }

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new Error(
        `NotebookBridge.applyPatch: WorkspaceEdit was rejected for cell ${String(cellIndex)}`,
      );
    }
  }
}

function cellKind(kind: vscode.NotebookCellKind): NotebookCell["cellType"] {
  switch (kind) {
    case vscode.NotebookCellKind.Code:
      return "code";
    case vscode.NotebookCellKind.Markup:
      return "markdown";
    default:
      return "raw";
  }
}
