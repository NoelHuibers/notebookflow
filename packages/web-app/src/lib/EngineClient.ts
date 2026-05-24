/**
 * EngineClient — WebSocket client for the NotebookFlow engine's `/ws` endpoint.
 *
 * Single-shot: each `runPipeline` call opens a fresh WebSocket, sends a
 * `run` message, forwards every server event to `onEvent`, and resolves
 * when `pipelineCompleted` or `error` lands.
 *
 * Mirrors `packages/jupyterlab-extension/src/EngineClient.ts` deliberately —
 * the two adapters share the same wire protocol, so duplicating the ~70
 * lines here keeps each package self-contained without adding a new shared
 * workspace package.
 */

interface NodeDef {
  id: string;
  name: string;
  tag: string;
  inputs: string[];
  outputs: string[];
  source: string;
  notebookPath: string;
  cellIndices: number[];
}

interface EdgeDef {
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
}

export interface PipelineDef {
  nodes: NodeDef[];
  edges: EdgeDef[];
}

export interface ExecutionResultMsg {
  nodeId: string;
  status: string;
  error: string | null;
  durationMs: number;
}

export type EngineEvent =
  | { type: "executionStarted"; pipelineId: string }
  | { type: "nodeCompleted"; pipelineId: string; result: ExecutionResultMsg }
  | { type: "pipelineCompleted"; pipelineId: string; results: ExecutionResultMsg[] }
  | { type: "error"; pipelineId?: string; message: string };

export const DEFAULT_ENGINE_URL =
  (import.meta.env.VITE_NOTEBOOKFLOW_ENGINE_URL as string | undefined) ?? "ws://localhost:8765/ws";

export interface RunOptions {
  pipelineId: string;
  pipeline: PipelineDef;
  onEvent: (event: EngineEvent) => void;
  url?: string;
}

export class EngineClient {
  private readonly url: string;

  constructor(url: string = DEFAULT_ENGINE_URL) {
    this.url = url;
  }

  get baseUrl(): string {
    return this.url;
  }

  runPipeline(opts: RunOptions): Promise<void> {
    const wsUrl = opts.url ?? this.url;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.addEventListener("open", () => {
        ws.send(
          JSON.stringify({
            type: "run",
            pipelineId: opts.pipelineId,
            pipeline: opts.pipeline,
          }),
        );
      });

      ws.addEventListener("message", (event) => {
        let parsed: EngineEvent;
        try {
          parsed = JSON.parse(event.data as string) as EngineEvent;
        } catch {
          return;
        }
        opts.onEvent(parsed);
        if (parsed.type === "pipelineCompleted" || parsed.type === "error") {
          ws.close();
          resolve();
        }
      });

      ws.addEventListener("error", () => {
        reject(new Error(`EngineClient: WebSocket error connecting to ${wsUrl}`));
      });

      ws.addEventListener("close", (event) => {
        if (!event.wasClean) {
          reject(
            new Error(`EngineClient: WebSocket closed uncleanly (code ${String(event.code)})`),
          );
        }
      });
    });
  }

  /** Lightweight liveness check via the engine's `/health` REST endpoint. */
  async ping(): Promise<boolean> {
    const httpUrl = this.url.replace(/^ws/, "http").replace(/\/ws$/, "/health");
    try {
      const res = await fetch(httpUrl);
      if (!res.ok) {
        return false;
      }
      const body = (await res.json()) as { status?: string };
      return body.status === "ok";
    } catch {
      return false;
    }
  }
}
