/**
 * VS Code platform adapter — extension entry point.
 *
 * Owns the engine subprocess (lazy-started on first canvas open, killed on
 * extension deactivate) and registers the `notebookflow.openCanvas` command
 * that opens a webview hosting the shared NotebookFlow Canvas, plus the
 * `notebookflow.setLlmApiKey` / `notebookflow.clearLlmApiKey` commands that
 * manage the bring-your-own-key LLM API key in VS Code's SecretStorage.
 */

import * as vscode from "vscode";

import { EngineProcess } from "./EngineProcess.js";
import { CanvasWebviewPanel, LLM_API_KEY_SECRET } from "./WebviewPanel.js";

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

  context.subscriptions.push(
    vscode.commands.registerCommand("notebookflow.setLlmApiKey", async () => {
      const value = await vscode.window.showInputBox({
        title: "NotebookFlow: Set LLM API Key",
        prompt:
          "API key for the configured LLM provider (see the notebookflow.llm.provider setting). Stored in VS Code's secret storage. Leave empty to clear.",
        password: true,
        ignoreFocusOut: true,
        placeHolder: "sk-…",
      });
      if (value === undefined) {
        return; // cancelled
      }
      const trimmed = value.trim();
      if (trimmed === "") {
        await context.secrets.delete(LLM_API_KEY_SECRET);
        void vscode.window.showInformationMessage("NotebookFlow: LLM API key cleared.");
        return;
      }
      await context.secrets.store(LLM_API_KEY_SECRET, trimmed);
      void vscode.window.showInformationMessage("NotebookFlow: LLM API key stored.");
    }),
    vscode.commands.registerCommand("notebookflow.clearLlmApiKey", async () => {
      await context.secrets.delete(LLM_API_KEY_SECRET);
      void vscode.window.showInformationMessage("NotebookFlow: LLM API key cleared.");
    }),
  );
}

export function deactivate(): void {
  if (engine !== null) {
    engine.dispose();
    engine = null;
  }
}
