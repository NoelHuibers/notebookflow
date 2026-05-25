/**
 * EngineClient — thin WebSocket wrapper over the NotebookFlow engine's ``/ws``.
 *
 * Opens one WebSocket per ``runPipeline`` call, sends the pipeline definition
 * as a single ``run`` message, then forwards every server-sent event through
 * the provided ``onEvent`` callback until ``pipelineCompleted`` or ``error``
 * arrives (whereupon the socket is closed and the call resolves).
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

export type NbOutput =
  | { output_type: "stream"; name: "stdout" | "stderr"; text: string }
  | {
      output_type: "display_data";
      data: Record<string, string>;
      metadata: Record<string, unknown>;
    }
  | {
      output_type: "execute_result";
      data: Record<string, string>;
      metadata: Record<string, unknown>;
    }
  | { output_type: "error"; ename: string; evalue: string; traceback: string[] };

interface ExecutionResultMsg {
  nodeId: string;
  status: string;
  error: string | null;
  durationMs: number;
  outputs: NbOutput[];
}

export type EngineEvent =
  | { type: "executionStarted"; pipelineId: string }
  | { type: "nodeCompleted"; pipelineId: string; result: ExecutionResultMsg }
  | { type: "pipelineCompleted"; pipelineId: string; results: ExecutionResultMsg[] }
  | { type: "error"; pipelineId?: string; message: string };

const DEFAULT_ENGINE_URL = "ws://127.0.0.1:8765/ws";

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
}
