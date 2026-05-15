/**
 * EngineProcess — spawns the FastAPI engine as a child process.
 *
 * Looks for an ``engine/`` directory in the workspace root and runs
 * ``uv run notebookflow`` inside it. Polls ``/health`` until the engine
 * answers, then exposes its base URL for the webview to connect to.
 *
 * Phase 5c keeps this small: one engine per VS Code window, lazy-started
 * on the first canvas open, killed on extension deactivate. Multi-workspace
 * support and remote engines are future work.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as path from "node:path";

import * as vscode from "vscode";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8765;
const HEALTH_POLL_INTERVAL_MS = 400;
const HEALTH_POLL_MAX_ATTEMPTS = 40; // ≈ 16 s

export class EngineProcess implements vscode.Disposable {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private url: string | null = null;
  private startPromise: Promise<string> | null = null;
  private readonly output: vscode.OutputChannel;

  constructor() {
    this.output = vscode.window.createOutputChannel("NotebookFlow Engine");
  }

  get baseUrl(): string | null {
    return this.url;
  }

  async start(): Promise<string> {
    if (this.url !== null) {
      return this.url;
    }
    if (this.startPromise !== null) {
      return this.startPromise;
    }
    this.startPromise = this._start().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async _start(): Promise<string> {
    const enginePath = this.findEngineDirectory();
    if (enginePath === null) {
      throw new Error(
        "NotebookFlow: no engine/ directory found in workspace. " +
          "Open a workspace that contains the engine package, or configure " +
          "notebookflow.enginePath in settings.",
      );
    }

    this.output.appendLine(`[engine] starting in ${enginePath}`);
    const proc = spawn("uv", ["run", "notebookflow"], {
      cwd: enginePath,
      shell: true,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    this.proc = proc;

    proc.stdout.on("data", (data: Buffer) => {
      this.output.append(data.toString("utf8"));
    });
    proc.stderr.on("data", (data: Buffer) => {
      this.output.append(data.toString("utf8"));
    });
    proc.on("exit", (code) => {
      this.output.appendLine(`[engine] exited with code ${String(code)}`);
      this.proc = null;
      this.url = null;
    });

    const url = `http://${DEFAULT_HOST}:${String(DEFAULT_PORT)}`;
    for (let attempt = 0; attempt < HEALTH_POLL_MAX_ATTEMPTS; attempt++) {
      if (proc.exitCode !== null) {
        throw new Error(`NotebookFlow engine exited early with code ${String(proc.exitCode)}`);
      }
      try {
        const res = await fetch(`${url}/health`);
        if (res.ok) {
          const body = (await res.json()) as { status?: string };
          if (body.status === "ok") {
            this.url = url;
            this.output.appendLine(`[engine] healthy at ${url}`);
            return url;
          }
        }
      } catch {
        // Engine not listening yet — keep polling.
      }
      await sleep(HEALTH_POLL_INTERVAL_MS);
    }
    proc.kill();
    throw new Error("NotebookFlow engine failed to become healthy within 16 seconds");
  }

  private findEngineDirectory(): string | null {
    const configured = vscode.workspace.getConfiguration("notebookflow").get<string>("enginePath");
    if (configured !== undefined && configured !== "") {
      return configured;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (folders === undefined) {
      return null;
    }
    for (const folder of folders) {
      const candidate = path.join(folder.uri.fsPath, "engine");
      // Lightweight existence check — let spawn surface the actual error if the
      // dir is missing or doesn't contain a runnable engine.
      if (folder.uri.scheme === "file") {
        return candidate;
      }
    }
    return null;
  }

  dispose(): void {
    if (this.proc !== null) {
      this.proc.kill();
      this.proc = null;
    }
    this.url = null;
    this.output.dispose();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
