/**
 * KernelBridge — execute pipeline nodes through the active JupyterLab kernel.
 *
 * Drop-in replacement for the engine WS path: same `runPipeline` shape and
 * the same `EngineEvent` stream, but each node runs via `kernel.requestExecute`
 * against the user's live notebook kernel so variables/imports declared in
 * the host notebook stay available to the pipeline (and vice versa).
 *
 * Topological order is derived from the supplied `PipelineDef.edges` via
 * Kahn's algorithm. On the first node failure we still emit a `nodeCompleted`
 * for every downstream node, marked as `"skipped"`, so the canvas's runtime
 * state map mirrors what the engine path produces.
 */

import type { Kernel, KernelMessage } from "@jupyterlab/services";

import type { EngineEvent, NbOutput, PipelineDef } from "./EngineClient";

type IOPubMessage =
  | KernelMessage.IStreamMsg
  | KernelMessage.IDisplayDataMsg
  | KernelMessage.IExecuteResultMsg
  | KernelMessage.IErrorMsg
  | KernelMessage.IStatusMsg;

export interface KernelRunOptions {
  pipelineId: string;
  pipeline: PipelineDef;
  onEvent: (event: EngineEvent) => void;
}

export class KernelBridge {
  private readonly resolveKernel: () => Kernel.IKernelConnection | null;

  constructor(
    kernelOrResolver: Kernel.IKernelConnection | (() => Kernel.IKernelConnection | null),
  ) {
    this.resolveKernel =
      typeof kernelOrResolver === "function"
        ? kernelOrResolver
        : (): Kernel.IKernelConnection | null => kernelOrResolver;
  }

  /** True when a live kernel is currently available. */
  get isReady(): boolean {
    return this.resolveKernel() !== null;
  }

  async runPipeline(opts: KernelRunOptions): Promise<void> {
    const kernel = this.resolveKernel();
    if (kernel === null) {
      opts.onEvent({
        type: "error",
        pipelineId: opts.pipelineId,
        message: "KernelBridge: no active kernel available",
      });
      return;
    }

    opts.onEvent({ type: "executionStarted", pipelineId: opts.pipelineId });

    const ordered = topologicalOrder(opts.pipeline);
    const results: NodeResult[] = [];

    let halted = false;
    for (const node of ordered) {
      if (halted) {
        const skipped: NodeResult = {
          nodeId: node.id,
          status: "skipped",
          error: null,
          durationMs: 0,
          outputs: [],
        };
        results.push(skipped);
        opts.onEvent({
          type: "nodeCompleted",
          pipelineId: opts.pipelineId,
          result: skipped,
        });
        continue;
      }

      opts.onEvent({
        type: "nodeStarted",
        pipelineId: opts.pipelineId,
        nodeId: node.id,
      });
      const result = await executeNodeOnKernel(kernel, node);
      results.push(result);
      opts.onEvent({
        type: "nodeCompleted",
        pipelineId: opts.pipelineId,
        result,
      });
      if (result.status === "error") {
        halted = true;
      }
    }

    opts.onEvent({
      type: "pipelineCompleted",
      pipelineId: opts.pipelineId,
      results,
    });
  }
}

interface NodeResult {
  nodeId: string;
  status: "ok" | "error" | "skipped";
  error: string | null;
  durationMs: number;
  outputs: NbOutput[];
}

async function executeNodeOnKernel(
  kernel: Kernel.IKernelConnection,
  node: PipelineDef["nodes"][number],
): Promise<NodeResult> {
  if (node.source === "") {
    return {
      nodeId: node.id,
      status: "ok",
      error: null,
      durationMs: 0,
      outputs: [],
    };
  }

  const outputs: NbOutput[] = [];
  let firstErrorSummary: string | null = null;

  const future = kernel.requestExecute({
    code: node.source,
    store_history: false,
    silent: false,
    stop_on_error: true,
  });

  future.onIOPub = (raw): void => {
    const msg = raw as IOPubMessage;
    const msgType = msg.header.msg_type;
    if (msgType === "stream") {
      appendStream(outputs, msg as KernelMessage.IStreamMsg);
    } else if (msgType === "display_data") {
      outputs.push(displayDataOutput(msg as KernelMessage.IDisplayDataMsg));
    } else if (msgType === "execute_result") {
      outputs.push(executeResultOutput(msg as KernelMessage.IExecuteResultMsg));
    } else if (msgType === "error") {
      const errMsg = msg as KernelMessage.IErrorMsg;
      outputs.push(errorOutput(errMsg));
      firstErrorSummary = `${errMsg.content.ename}: ${errMsg.content.evalue}`;
    }
  };

  const startMs = performance.now();
  let reply: KernelMessage.IExecuteReplyMsg;
  try {
    reply = await future.done;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown kernel error";
    return {
      nodeId: node.id,
      status: "error",
      error: `KernelBridge: ${message}`,
      durationMs: performance.now() - startMs,
      outputs,
    };
  }
  const durationMs = performance.now() - startMs;

  if (reply.content.status === "error") {
    return {
      nodeId: node.id,
      status: "error",
      error: firstErrorSummary ?? "kernel execution failed",
      durationMs,
      outputs,
    };
  }
  return {
    nodeId: node.id,
    status: "ok",
    error: null,
    durationMs,
    outputs,
  };
}

function appendStream(outputs: NbOutput[], msg: KernelMessage.IStreamMsg): void {
  const name = msg.content.name === "stderr" ? "stderr" : "stdout";
  const last = outputs[outputs.length - 1];
  if (last !== undefined && last.output_type === "stream" && last.name === name) {
    last.text += msg.content.text;
    return;
  }
  outputs.push({ output_type: "stream", name, text: msg.content.text });
}

function displayDataOutput(msg: KernelMessage.IDisplayDataMsg): NbOutput {
  return {
    output_type: "display_data",
    data: stringifyData(msg.content.data),
    metadata: (msg.content.metadata ?? {}) as Record<string, unknown>,
  };
}

function executeResultOutput(msg: KernelMessage.IExecuteResultMsg): NbOutput {
  return {
    output_type: "execute_result",
    data: stringifyData(msg.content.data),
    metadata: (msg.content.metadata ?? {}) as Record<string, unknown>,
  };
}

function errorOutput(msg: KernelMessage.IErrorMsg): NbOutput {
  return {
    output_type: "error",
    ename: msg.content.ename,
    evalue: msg.content.evalue,
    traceback: msg.content.traceback,
  };
}

/** nbformat data bundles are loosely typed; flatten to Record<string, string>. */
function stringifyData(data: Record<string, unknown> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (data === undefined) {
    return result;
  }
  for (const [mime, value] of Object.entries(data)) {
    if (typeof value === "string") {
      result[mime] = value;
    } else if (Array.isArray(value)) {
      result[mime] = value.map((line) => (typeof line === "string" ? line : "")).join("");
    } else if (value !== null && value !== undefined) {
      try {
        result[mime] = JSON.stringify(value);
      } catch {
        result[mime] = String(value);
      }
    }
  }
  return result;
}

/** Kahn's algorithm over PipelineDef edges. Stable for tie-breaks. */
function topologicalOrder(pipeline: PipelineDef): PipelineDef["nodes"] {
  const nodeIds = pipeline.nodes.map((node) => node.id);
  const indegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>(nodeIds.map((id) => [id, []]));

  for (const edge of pipeline.edges) {
    if (!indegree.has(edge.targetNodeId) || !outgoing.has(edge.sourceNodeId)) {
      continue;
    }
    indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1);
    outgoing.get(edge.sourceNodeId)?.push(edge.targetNodeId);
  }

  const ready = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  const ordered: string[] = [];
  while (ready.length > 0) {
    const next = ready.shift() ?? "";
    ordered.push(next);
    for (const downstream of outgoing.get(next) ?? []) {
      const remaining = (indegree.get(downstream) ?? 0) - 1;
      indegree.set(downstream, remaining);
      if (remaining === 0) {
        ready.push(downstream);
      }
    }
  }

  // If a cycle is present we fall back to insertion order so the run still
  // happens; the engine path would 400 here, but for the kernel path we
  // prefer a best-effort run over rejecting the dispatch.
  if (ordered.length !== nodeIds.length) {
    return pipeline.nodes;
  }
  const byId = new Map(pipeline.nodes.map((node) => [node.id, node] as const));
  return ordered
    .map((id) => byId.get(id))
    .filter((node): node is PipelineDef["nodes"][number] => node !== undefined);
}
