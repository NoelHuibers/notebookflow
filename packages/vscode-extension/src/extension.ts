/**
 * VS Code platform adapter — extension entry point.
 *
 * On activation, spawns the FastAPI engine as a child process and registers
 * the `notebookflow.openCanvas` command, which opens a WebviewPanel hosting
 * the shared graph canvas.
 */

import type * as vscode from "vscode";

export function activate(_context: vscode.ExtensionContext): void {
  // TODO: spawn engine via child_process, register command opening WebviewPanel,
  //   wire NotebookBridge into vscode.notebooks API.
  throw new Error("vscode-extension.activate: not implemented");
}

export function deactivate(): void {
  // TODO: terminate the spawned engine process cleanly.
}
