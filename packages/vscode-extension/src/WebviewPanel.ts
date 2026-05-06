/**
 * WebviewPanel — hosts the shared React graph canvas inside VS Code.
 *
 * The webview bundles @notebookflow/graph-canvas and communicates with the
 * extension host (which owns the WebSocket to the FastAPI engine) via
 * postMessage.
 */

import type * as vscode from "vscode";

export class CanvasWebviewPanel {
  constructor(_context: vscode.ExtensionContext) {
    // TODO: create vscode.window.createWebviewPanel, load bundled HTML+JS,
    //   set up postMessage bridge for graph updates and cell patches.
  }

  reveal(): void {
    throw new Error("CanvasWebviewPanel.reveal: not implemented");
  }
}
