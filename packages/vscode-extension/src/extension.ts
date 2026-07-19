/**
 * VS Code platform adapter — extension entry point.
 *
 * Owns the engine subprocess (lazy-started on first canvas open, killed on
 * extension deactivate) and registers the `notebookflow.openCanvas` command
 * that opens a webview hosting the shared NotebookFlow Canvas, plus the
 * `notebookflow.setLlmApiKey` / `notebookflow.clearLlmApiKey` commands that
 * manage the bring-your-own-key LLM API key in VS Code's SecretStorage.
 *
 * Cloud account (#88, optional): the `notebookflow.cloud*` commands sign in
 * to the hosted web app via the device-authorization flow and add cloud
 * notebook open/save on top — implemented in cloud.ts, token in
 * SecretStorage. Signed-out behavior is unchanged.
 */

import * as vscode from "vscode";

import {
  CLOUD_TOKEN_SECRET,
  cloudSignIn,
  cloudSignOut,
  cloudStatusPicker,
  openCloudNotebook,
  saveNotebookToCloud,
} from "./cloud.js";
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

  // Cloud account commands (#88) — optional, additive; see cloud.ts.
  context.subscriptions.push(
    vscode.commands.registerCommand("notebookflow.cloudSignIn", () => cloudSignIn(context)),
    vscode.commands.registerCommand("notebookflow.cloudSignOut", () => cloudSignOut(context)),
    vscode.commands.registerCommand("notebookflow.openCloudNotebook", () =>
      openCloudNotebook(context),
    ),
    vscode.commands.registerCommand("notebookflow.saveNotebookToCloud", () =>
      saveNotebookToCloud(context),
    ),
    // Internal (not in the palette): backs the status bar item below.
    vscode.commands.registerCommand("notebookflow.cloudStatus", () => cloudStatusPicker(context)),
  );

  // Status bar item reflecting the cloud sign-in state.
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = "$(cloud) NotebookFlow";
  statusBar.command = "notebookflow.cloudStatus";
  const updateStatusBar = async (): Promise<void> => {
    const token = (await context.secrets.get(CLOUD_TOKEN_SECRET)) ?? "";
    statusBar.tooltip =
      token === ""
        ? "NotebookFlow Cloud: signed out — click to sign in"
        : "NotebookFlow Cloud: signed in — click for cloud actions";
  };
  void updateStatusBar();
  statusBar.show();
  context.subscriptions.push(
    statusBar,
    context.secrets.onDidChange((event) => {
      if (event.key === CLOUD_TOKEN_SECRET) {
        void updateStatusBar();
      }
    }),
  );
}

export function deactivate(): void {
  if (engine !== null) {
    engine.dispose();
    engine = null;
  }
}
