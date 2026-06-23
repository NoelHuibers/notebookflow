/**
 * EngineClient — thin WebSocket wrapper over the NotebookFlow engine's ``/ws``.
 *
 * Opens one WebSocket per ``runPipeline`` call, sends the pipeline definition
 * as a single ``run`` message, then forwards every server-sent event through
 * the provided ``onEvent`` callback until ``pipelineCompleted`` or ``error``
 * arrives (whereupon the socket is closed and the call resolves).
 */

import type {
  NodeManifestDef,
  NodeSynthesisRequest,
  NodeSynthesisResponse,
} from "@notebookflow/graph-canvas";

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
  | { type: "nodeStarted"; pipelineId: string; nodeId: string }
  | { type: "nodeCompleted"; pipelineId: string; result: ExecutionResultMsg }
  | { type: "pipelineCompleted"; pipelineId: string; results: ExecutionResultMsg[] }
  | { type: "error"; pipelineId?: string; message: string };

const FALLBACK_ENGINE_URL = "ws://127.0.0.1:8765/ws";
const PROXY_PORT = 8765;

/**
 * Build the engine WebSocket URL that runs through jupyter-server-proxy when
 * we're inside a JupyterLab page. Strips the trailing /lab[...] from the
 * current pathname so the proxy is rooted at the Jupyter base URL -- works
 * for vanilla `localhost:8888/lab` and for JupyterHub paths like
 * `localhost:8888/user/me/lab`.
 *
 * Falls back to the loopback URL for tests + non-browser hosts.
 */
export function resolveDefaultEngineUrl(): string {
  if (typeof window === "undefined" || typeof window.location === "undefined") {
    return FALLBACK_ENGINE_URL;
  }
  const loc = window.location;
  if (loc.host === "" || loc.protocol === "file:") {
    return FALLBACK_ENGINE_URL;
  }
  const wsProto = loc.protocol === "https:" ? "wss" : "ws";
  const trimmedPath = (loc.pathname || "/").replace(/\/+$/, "");
  const baseRoot = trimmedPath.replace(/\/lab(\/.*)?$/, "") || "";
  return `${wsProto}://${loc.host}${baseRoot}/proxy/${String(PROXY_PORT)}/ws`;
}

export interface RunOptions {
  pipelineId: string;
  pipeline: PipelineDef;
  onEvent: (event: EngineEvent) => void;
  url?: string;
}

export class EngineClient {
  private readonly url: string;

  constructor(url: string = resolveDefaultEngineUrl()) {
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

  async listNodes(): Promise<NodeManifestDef[]> {
    const httpUrl = this.url.replace(/^ws/, "http").replace(/\/ws$/, "/nodes");
    const res = await fetch(httpUrl);
    if (!res.ok) {
      throw new Error(`EngineClient.listNodes: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as NodeManifestDef[];
  }

  async synthesizeNode(request: NodeSynthesisRequest): Promise<NodeSynthesisResponse> {
    const httpUrl = this.url.replace(/^ws/, "http").replace(/\/ws$/, "/nodes/synthesize");
    const res = await fetch(httpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const message = await readErrorMessage(res);
      throw new Error(`EngineClient.synthesizeNode: ${message}`);
    }
    return (await res.json()) as NodeSynthesisResponse;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail ?? `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}
