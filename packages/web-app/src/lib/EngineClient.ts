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
  /** Notebook alias for resolving cross-notebook input refs (empty = single-file). */
  alias: string;
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

/**
 * nbformat-shaped output dicts emitted by the engine for each executed node.
 * Snake_case keys match the wire payload + nbformat-v4 schema, so these
 * structs round-trip cleanly into a downloaded `.ipynb`.
 */
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

export interface ExecutionResultMsg {
  nodeId: string;
  status: string;
  error: string | null;
  durationMs: number;
  outputs: NbOutput[];
  // Shape hints derived from the node's output ports, e.g. {rows, cols}.
  // Empty/absent when no output is sized.
  metadata?: { rows?: number; cols?: number };
}

export type EngineEvent =
  | { type: "executionStarted"; pipelineId: string }
  | { type: "nodeStarted"; pipelineId: string; nodeId: string }
  | { type: "nodeCompleted"; pipelineId: string; result: ExecutionResultMsg }
  | { type: "pipelineCompleted"; pipelineId: string; results: ExecutionResultMsg[] }
  | { type: "error"; pipelineId?: string; message: string };

const FALLBACK_ENGINE_URL = "ws://localhost:8765/ws";

/**
 * Resolve the engine WebSocket URL from the env var, falling back to localhost
 * if the value is missing or doesn't look like a WS URL.
 *
 * The validation guards against a common Vercel misconfiguration: pasting the
 * whole `VITE_NOTEBOOKFLOW_ENGINE_URL = ws://…` line into the Value field
 * instead of just the URL. Without this guard, WebSocket would try to connect
 * to the env-var name itself and produce a baffling error.
 */
function resolveEngineUrl(): string {
  const raw = import.meta.env.VITE_NOTEBOOKFLOW_ENGINE_URL as string | undefined;
  if (raw === undefined) {
    return FALLBACK_ENGINE_URL;
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return FALLBACK_ENGINE_URL;
  }
  if (!/^wss?:\/\//.test(trimmed)) {
    console.warn(
      `VITE_NOTEBOOKFLOW_ENGINE_URL is "${trimmed}" — expected ws:// or wss:// URL. ` +
        `Check the Value field in your Vercel env vars: it should be the URL only, ` +
        `not "KEY=VALUE". Falling back to ${FALLBACK_ENGINE_URL}.`,
    );
    return FALLBACK_ENGINE_URL;
  }
  return trimmed;
}

export const DEFAULT_ENGINE_URL = resolveEngineUrl();

/**
 * Optional shared-secret token for engines deployed with
 * NOTEBOOKFLOW_AUTH_TOKEN set. Empty means "auth disabled" -- the client
 * sends no Authorization header and skips the WS token query param.
 */
function resolveEngineToken(): string {
  const raw = import.meta.env.VITE_NOTEBOOKFLOW_ENGINE_TOKEN;
  if (raw === undefined) {
    return "";
  }
  return raw.trim();
}

export const DEFAULT_ENGINE_TOKEN = resolveEngineToken();

export interface RunOptions {
  pipelineId: string;
  pipeline: PipelineDef;
  onEvent: (event: EngineEvent) => void;
  url?: string;
}

export class EngineClient {
  private readonly url: string;
  private readonly token: string;

  constructor(url: string = DEFAULT_ENGINE_URL, token: string = DEFAULT_ENGINE_TOKEN) {
    this.url = url;
    this.token = token;
  }

  get baseUrl(): string {
    return this.url;
  }

  private authHeaders(): Record<string, string> {
    return this.token === "" ? {} : { Authorization: `Bearer ${this.token}` };
  }

  private wsUrlWithToken(base: string): string {
    if (this.token === "") {
      return base;
    }
    const joiner = base.includes("?") ? "&" : "?";
    return `${base}${joiner}token=${encodeURIComponent(this.token)}`;
  }

  runPipeline(opts: RunOptions): Promise<void> {
    const wsUrl = this.wsUrlWithToken(opts.url ?? this.url);
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

  /**
   * Ask the engine to statically analyze cell sources and return, per cell,
   * the names bound at module top level. Used to autocomplete port variable
   * names on the canvas. Returns one entry per input cell, in order; falls
   * back to empty arrays if the engine is unreachable.
   */
  async analyzeCells(sources: string[]): Promise<string[][]> {
    const httpUrl = this.url.replace(/^ws/, "http").replace(/\/ws$/, "/cells/analyze");
    const empty = sources.map(() => []);
    try {
      const res = await fetch(httpUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({ cells: sources.map((source) => ({ source })) }),
      });
      if (!res.ok) {
        return empty;
      }
      const body = (await res.json()) as { cells?: { definedNames?: string[] }[] };
      const cells = body.cells ?? [];
      return sources.map((_, idx) => cells[idx]?.definedNames ?? []);
    } catch {
      return empty;
    }
  }

  /** Fetch the node registry for the manifest-driven add-node palette. */
  async listNodes(): Promise<NodeManifestDef[]> {
    const httpUrl = this.url.replace(/^ws/, "http").replace(/\/ws$/, "/nodes");
    const res = await fetch(httpUrl, { headers: this.authHeaders() });
    if (!res.ok) {
      throw new Error(`EngineClient.listNodes: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as NodeManifestDef[];
  }

  async synthesizeNode(request: NodeSynthesisRequest): Promise<NodeSynthesisResponse> {
    const httpUrl = this.url.replace(/^ws/, "http").replace(/\/ws$/, "/nodes/synthesize");
    const res = await fetch(httpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const message = await readErrorMessage(res);
      throw new Error(`EngineClient.synthesizeNode: ${message}`);
    }
    return (await res.json()) as NodeSynthesisResponse;
  }

  /**
   * Ask the engine for a literate prose walkthrough of the current pipeline.
   * Backed by Anthropic when configured server-side; otherwise a deterministic
   * template outline.
   */
  async explainPipeline(pipeline: PipelineDef, instruction = ""): Promise<PipelineExplanation> {
    const httpUrl = this.url.replace(/^ws/, "http").replace(/\/ws$/, "/pipelines/explain");
    const res = await fetch(httpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify({ pipeline, instruction }),
    });
    if (!res.ok) {
      const message = await readErrorMessage(res);
      throw new Error(`EngineClient.explainPipeline: ${message}`);
    }
    return (await res.json()) as PipelineExplanation;
  }

  /**
   * Free-form Q&A backing the Cmd/Ctrl+K command palette. Backed by
   * Anthropic when configured; falls back to a keyword-driven template
   * hint that nudges the user toward the matching button.
   */
  async askLLM(prompt: string, pipeline?: PipelineDef): Promise<AskAnswer> {
    const httpUrl = this.url.replace(/^ws/, "http").replace(/\/ws$/, "/llm/ask");
    const body: { prompt: string; pipeline?: PipelineDef } = { prompt };
    if (pipeline !== undefined) {
      body.pipeline = pipeline;
    }
    const res = await fetch(httpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const message = await readErrorMessage(res);
      throw new Error(`EngineClient.askLLM: ${message}`);
    }
    return (await res.json()) as AskAnswer;
  }

  /**
   * Draft a fresh pipeline from a natural-language prompt. Backed by
   * Anthropic when configured; falls back to a keyword-driven template
   * draft otherwise.
   */
  async proposePipeline(prompt: string, notebookPath = ""): Promise<PipelineProposal> {
    const httpUrl = this.url.replace(/^ws/, "http").replace(/\/ws$/, "/pipelines/propose");
    const body: { prompt: string; notebookPath?: string } = { prompt };
    if (notebookPath !== "") {
      body.notebookPath = notebookPath;
    }
    const res = await fetch(httpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const message = await readErrorMessage(res);
      throw new Error(`EngineClient.proposePipeline: ${message}`);
    }
    return (await res.json()) as PipelineProposal;
  }

  // ---------------------------------------------------------------------
  // Triggers (manual / cron / file_watch / webhook). Backs the Triggers
  // dialog in the top bar; engine REST surface lives in server.py at
  // /triggers, /triggers/{id}/fire, /triggers/{id}/firings.
  // ---------------------------------------------------------------------

  private httpBase(): string {
    return this.url.replace(/^ws/, "http").replace(/\/ws$/, "");
  }

  async listTriggers(): Promise<TriggerSpec[]> {
    const res = await fetch(`${this.httpBase()}/triggers`, {
      headers: { ...this.authHeaders() },
    });
    if (!res.ok) {
      throw new Error(`EngineClient.listTriggers: ${await readErrorMessage(res)}`);
    }
    return (await res.json()) as TriggerSpec[];
  }

  async registerTrigger(spec: TriggerSpec): Promise<TriggerSpec> {
    const res = await fetch(`${this.httpBase()}/triggers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify(spec),
    });
    if (!res.ok) {
      throw new Error(`EngineClient.registerTrigger: ${await readErrorMessage(res)}`);
    }
    return (await res.json()) as TriggerSpec;
  }

  async unregisterTrigger(id: string): Promise<void> {
    const res = await fetch(`${this.httpBase()}/triggers/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { ...this.authHeaders() },
    });
    if (!res.ok) {
      throw new Error(`EngineClient.unregisterTrigger: ${await readErrorMessage(res)}`);
    }
  }

  async fireTrigger(id: string, payload: Record<string, unknown> = {}): Promise<TriggerFiring> {
    const res = await fetch(`${this.httpBase()}/triggers/${encodeURIComponent(id)}/fire`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify({ payload }),
    });
    if (!res.ok) {
      throw new Error(`EngineClient.fireTrigger: ${await readErrorMessage(res)}`);
    }
    return (await res.json()) as TriggerFiring;
  }

  async listFirings(id: string): Promise<TriggerFiring[]> {
    const res = await fetch(`${this.httpBase()}/triggers/${encodeURIComponent(id)}/firings`, {
      headers: { ...this.authHeaders() },
    });
    if (!res.ok) {
      throw new Error(`EngineClient.listFirings: ${await readErrorMessage(res)}`);
    }
    return (await res.json()) as TriggerFiring[];
  }

  /** The ready-to-paste URL a third party hits to fire this trigger. */
  webhookUrl(triggerId: string): string {
    return `${this.httpBase()}/triggers/${encodeURIComponent(triggerId)}/fire`;
  }
}

export type TriggerKind = "manual" | "cron" | "file_watch" | "webhook";

export interface TriggerSpec {
  id: string;
  kind: TriggerKind;
  pipelineId: string;
  config: Record<string, unknown>;
}

export interface TriggerFiring {
  triggerId: string;
  firedAt: number;
  payload: Record<string, unknown>;
}

export interface PipelineExplanation {
  prose: string;
  backend: string;
  warnings: string[];
}

export interface AskAnswer {
  answer: string;
  backend: string;
  warnings: string[];
}

export interface PipelineProposalNode {
  manifestId: string;
  name: string;
  config: Record<string, string>;
}

export interface PipelineProposal {
  notebookPath: string;
  cellSources: string[];
  nodes: PipelineProposalNode[];
  edges: { from: string; to: string }[];
  backend: string;
  warnings: string[];
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail ?? `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}
