/**
 * NotebookBridge — adapter over vscode.notebooks API.
 *
 * Translates VS Code's NotebookDocument cell model into the platform-neutral
 * `NotebookCell` shape consumed by the SyncEngine, and applies cell patches
 * back via WorkspaceEdit.
 */

import type * as vscode from "vscode";
import type { NotebookCell } from "@notebookflow/graph-canvas/sync";

export class NotebookBridge {
  constructor(_doc: vscode.NotebookDocument) {
    // TODO: capture doc ref, subscribe to vscode.workspace.onDidChangeNotebookDocument.
  }

  readCells(): NotebookCell[] {
    throw new Error("NotebookBridge.readCells: not implemented");
  }

  async applyPatch(_cellIndex: number, _newSource: string | null): Promise<void> {
    // TODO: build WorkspaceEdit for cell content replace or delete.
    throw new Error("NotebookBridge.applyPatch: not implemented");
  }
}
