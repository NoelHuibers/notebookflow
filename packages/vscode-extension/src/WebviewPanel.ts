/**
 * CanvasWebviewPanel — hosts the bundled React Canvas inside VS Code.
 *
 * Loads the Vite-built ``dist-webview/index.html`` and rewrites its asset
 * URIs through ``webview.asWebviewUri`` so the bundle can be served from
 * the extension's install directory. Bridges three flows:
 *
 *   - extension → webview: ``ingest`` (cells), ``engineUrl`` / ``engineDown``.
 *   - webview → extension: ``patch`` plus output updates for executed cells.
 *
 * Pipeline execution itself runs webview ↔ engine over a direct WebSocket;
 * the extension stays out of the hot path.
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

import type { EngineProcess } from "./EngineProcess.js";
import { type NbOutput, NotebookBridge } from "./NotebookBridge.js";

interface PatchMessage {
  type: "patch";
  cellIndex: number;
  newSource: string | null;
}

interface ReadyMessage {
  type: "webviewReady";
}

interface ReplaceOutputsMessage {
  type: "replaceOutputs";
  cellIndex: number;
  outputs: NbOutput[];
  status: string;
  durationMs: number;
}

interface ClearOutputsMessage {
  type: "clearOutputs";
  cellIndices: number[];
}

function isPatchMessage(msg: unknown): msg is PatchMessage {
  if (typeof msg !== "object" || msg === null) {
    return false;
  }
  const candidate = msg as { type?: unknown; cellIndex?: unknown; newSource?: unknown };
  if (candidate.type !== "patch") {
    return false;
  }
  if (typeof candidate.cellIndex !== "number") {
    return false;
  }
  return typeof candidate.newSource === "string" || candidate.newSource === null;
}

function isReadyMessage(msg: unknown): msg is ReadyMessage {
  return (
    typeof msg === "object" && msg !== null && (msg as { type?: unknown }).type === "webviewReady"
  );
}

function isReplaceOutputsMessage(msg: unknown): msg is ReplaceOutputsMessage {
  if (typeof msg !== "object" || msg === null) {
    return false;
  }
  const candidate = msg as {
    type?: unknown;
    cellIndex?: unknown;
    outputs?: unknown;
    status?: unknown;
    durationMs?: unknown;
  };
  return (
    candidate.type === "replaceOutputs" &&
    typeof candidate.cellIndex === "number" &&
    Array.isArray(candidate.outputs) &&
    typeof candidate.status === "string" &&
    typeof candidate.durationMs === "number"
  );
}

function isClearOutputsMessage(msg: unknown): msg is ClearOutputsMessage {
  if (typeof msg !== "object" || msg === null) {
    return false;
  }
  const candidate = msg as { type?: unknown; cellIndices?: unknown };
  return (
    candidate.type === "clearOutputs" &&
    Array.isArray(candidate.cellIndices) &&
    candidate.cellIndices.every((cellIndex) => typeof cellIndex === "number")
  );
}

export class CanvasWebviewPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly bridge: NotebookBridge;
  private readonly engine: EngineProcess;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private messageQueue: Promise<void> = Promise.resolve();

  static create(
    context: vscode.ExtensionContext,
    doc: vscode.NotebookDocument,
    engine: EngineProcess,
  ): CanvasWebviewPanel {
    const fileName = doc.uri.path.split("/").pop() ?? "notebook";
    const distWebview = vscode.Uri.joinPath(context.extensionUri, "dist-webview");
    const panel = vscode.window.createWebviewPanel(
      "notebookflow.canvas",
      `NotebookFlow: ${fileName}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [distWebview],
      },
    );
    return new CanvasWebviewPanel(context, panel, doc, engine);
  }

  constructor(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    doc: vscode.NotebookDocument,
    engine: EngineProcess,
  ) {
    this.panel = panel;
    this.bridge = new NotebookBridge(doc);
    this.engine = engine;
    this.extensionUri = context.extensionUri;

    panel.webview.html = this.renderHtml();

    this.disposables.push(
      panel.webview.onDidReceiveMessage((msg: unknown) => {
        this.messageQueue = this.messageQueue
          .then(() => this.handleMessage(msg))
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : "unknown error";
            void vscode.window.showErrorMessage(`NotebookFlow: bridge update failed — ${message}`);
          });
      }),
      vscode.workspace.onDidChangeNotebookDocument((event) => {
        if (event.notebook === doc) {
          this.sendIngest();
        }
      }),
      panel.onDidDispose(() => {
        this.dispose();
      }),
    );

    // Initial ingest + engine kick happen in handleMessage on the
    // webview's `webviewReady` signal — sending them now would race
    // ahead of the React app's message listener and get dropped.
  }

  reveal(): void {
    this.panel.reveal();
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private sendIngest(): void {
    void this.panel.webview.postMessage({
      type: "ingest",
      path: this.bridge.notebookPath,
      cells: this.bridge.readCells(),
      timestamp: Date.now(),
    });
  }

  private async kickEngine(): Promise<void> {
    try {
      const url = await this.engine.start();
      void this.panel.webview.postMessage({ type: "engineUrl", url });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      void this.panel.webview.postMessage({ type: "engineDown", reason: message });
      void vscode.window.showWarningMessage(
        `NotebookFlow: engine failed to start — ${message}. Canvas will work, but Run is disabled.`,
      );
    }
  }

  private async handleMessage(msg: unknown): Promise<void> {
    if (isReadyMessage(msg)) {
      this.sendIngest();
      void this.kickEngine();
      return;
    }
    if (isClearOutputsMessage(msg)) {
      await this.bridge.clearOutputs(msg.cellIndices);
      return;
    }
    if (isReplaceOutputsMessage(msg)) {
      await this.bridge.replaceOutputs(msg.cellIndex, msg.outputs, msg.status, msg.durationMs);
      return;
    }
    if (isPatchMessage(msg)) {
      await this.bridge.applyPatch(msg.cellIndex, msg.newSource);
    }
  }

  private renderHtml(): string {
    const distWebview = vscode.Uri.joinPath(this.extensionUri, "dist-webview");
    const indexPath = path.join(distWebview.fsPath, "index.html");

    let html: string;
    try {
      html = fs.readFileSync(indexPath, "utf8");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      return fallbackHtml(
        `Could not read the webview bundle at ${indexPath}. Did you run ` +
          `\`pnpm --filter @notebookflow/vscode-extension build\`? Underlying error: ${message}`,
      );
    }

    const nonce = randomBytes(16).toString("hex");
    const cspSource = this.panel.webview.cspSource;

    html = html.replace(/(href|src)="([^"]+)"/g, (match, attr: string, value: string) => {
      if (/^(https?:|data:|vscode-webview:)/.test(value)) {
        return match;
      }
      const cleaned = value.replace(/^\.\//, "").replace(/^\//, "");
      const uri = this.panel.webview.asWebviewUri(
        vscode.Uri.joinPath(distWebview, ...cleaned.split("/")),
      );
      return `${attr}="${uri.toString()}"`;
    });

    const csp = [
      `default-src 'none'`,
      `script-src ${cspSource} 'nonce-${nonce}'`,
      `style-src ${cspSource} 'unsafe-inline'`,
      `img-src ${cspSource} data:`,
      `font-src ${cspSource}`,
      `connect-src ${cspSource} ws://127.0.0.1:* http://127.0.0.1:*`,
    ].join("; ");

    html = html.replace(/<script\b/g, `<script nonce="${nonce}"`);
    html = html.replace(
      /<head>/,
      `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`,
    );

    return html;
  }
}

function fallbackHtml(message: string): string {
  return `<!doctype html><html><body style="font-family: var(--vscode-font-family); padding: 16px;">
    <h2>NotebookFlow</h2>
    <p>${message}</p>
  </body></html>`;
}
