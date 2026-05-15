/**
 * VS Code platform adapter — extension entry point.
 *
 * Owns the engine subprocess (lazy-started on first canvas open, killed on
 * extension deactivate) and registers the `notebookflow.openCanvas` command
 * that opens a webview hosting the shared NotebookFlow Canvas.
 */

import * as vscode from "vscode";

import { EngineProcess } from "./EngineProcess.js";
import { CanvasWebviewPanel } from "./WebviewPanel.js";

let engine: EngineProcess | null = null;

export function activate(context: vscode.ExtensionContext): void {
  engine = new EngineProcess();
  context.subscriptions.push(engine);

  context.subscriptions.push(
    vscode.commands.registerCommand("notebookflow.openCanvas", () => {
      const editor = vscode.window.activeNotebookEditor;
      if (editor === undefined) {
        void vscode.window.showErrorMessage(
          "NotebookFlow: open a Jupyter notebook before running this command.",
        );
        return;
      }
      if (engine === null) {
        void vscode.window.showErrorMessage(
          "NotebookFlow: extension is deactivating; cannot open the canvas.",
        );
        return;
      }
      CanvasWebviewPanel.create(context, editor.notebook, engine);
    }),
  );
}

export function deactivate(): void {
  if (engine !== null) {
    engine.dispose();
    engine = null;
  }
}
