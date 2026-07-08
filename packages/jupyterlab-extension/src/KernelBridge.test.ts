import type { Kernel, KernelMessage } from "@jupyterlab/services";
import { describe, expect, it, vi } from "vitest";

import type { EngineEvent, PipelineDef } from "./EngineClient";
import { extractCellSourceFromWrapper } from "./isolatedExecution";
import { KernelBridge } from "./KernelBridge";

interface ScriptStep {
  type: "iopub" | "reply";
  msg?: Partial<KernelMessage.IIOPubMessage> & { header: { msg_type: string }; content: unknown };
  reply?: { status: "ok" | "error" | "aborted" };
}

interface QueuedRun {
  code: string;
  script: ScriptStep[];
}

/**
 * Stand-in for Kernel.IKernelConnection that returns a scripted IFuture each
 * time `requestExecute` is called. The script is consumed FIFO so each node
 * in the pipeline gets its own outputs + reply.
 */
function fakeKernel(scripts: ScriptStep[][]): {
  kernel: Kernel.IKernelConnection;
  invocations: QueuedRun[];
} {
  const invocations: QueuedRun[] = [];
  const remaining = [...scripts];
  const requestExecute = (request: { code: string }): unknown => {
    const script = remaining.shift() ?? [];
    invocations.push({ code: request.code, script });
    const ioPubHandlers: ((msg: KernelMessage.IIOPubMessage) => void)[] = [];
    let resolveDone: (reply: KernelMessage.IExecuteReplyMsg) => void = () => {};
    const done = new Promise<KernelMessage.IExecuteReplyMsg>((resolve) => {
      resolveDone = resolve;
    });

    const future: Partial<
      Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>
    > = {
      done,
      set onIOPub(handler: (msg: KernelMessage.IIOPubMessage) => void) {
        ioPubHandlers.push(handler);
      },
    };

    // Drive the script asynchronously so the consumer can attach onIOPub
    // before any messages fire (mirrors real kernel behaviour).
    queueMicrotask(() => {
      for (const step of script) {
        if (step.type === "iopub" && step.msg !== undefined) {
          const msg = step.msg as KernelMessage.IIOPubMessage;
          for (const handler of ioPubHandlers) {
            handler(msg);
          }
        } else if (step.type === "reply") {
          const replyContent = { ...(step.reply ?? { status: "ok" }), execution_count: 1 };
          resolveDone({
            header: { msg_type: "execute_reply" } as KernelMessage.IHeader<"execute_reply">,
            parent_header: {} as KernelMessage.IHeader,
            metadata: {},
            content: replyContent as KernelMessage.IExecuteReplyMsg["content"],
            buffers: [],
            channel: "shell",
          } as KernelMessage.IExecuteReplyMsg);
        }
      }
    });

    return future;
  };

  const kernel = { requestExecute } as unknown as Kernel.IKernelConnection;
  return { kernel, invocations };
}

function linearPipeline(): PipelineDef {
  return {
    nodes: [
      {
        id: "a",
        name: "A",
        tag: "input",
        inputs: [],
        outputs: ["df"],
        source: "df = 1\n",
        notebookPath: "",
        cellIndices: [0],
      },
      {
        id: "b",
        name: "B",
        tag: "transform",
        inputs: ["df<-A.df"],
        outputs: ["clean"],
        source: "clean = df + 1\n",
        notebookPath: "",
        cellIndices: [1],
      },
    ],
    edges: [{ sourceNodeId: "a", sourcePort: "df", targetNodeId: "b", targetPort: "df<-A.df" }],
  };
}

function streamMsg(name: "stdout" | "stderr", text: string): KernelMessage.IStreamMsg {
  return {
    header: { msg_type: "stream" } as KernelMessage.IHeader<"stream">,
    parent_header: {} as KernelMessage.IHeader,
    metadata: {},
    content: { name, text },
    buffers: [],
    channel: "iopub",
  } as KernelMessage.IStreamMsg;
}

function errorIOPub(ename: string, evalue: string): KernelMessage.IErrorMsg {
  return {
    header: { msg_type: "error" } as KernelMessage.IHeader<"error">,
    parent_header: {} as KernelMessage.IHeader,
    metadata: {},
    content: { ename, evalue, traceback: [`${ename}: ${evalue}`] },
    buffers: [],
    channel: "iopub",
  } as KernelMessage.IErrorMsg;
}

async function collectEvents(bridge: KernelBridge, pipeline: PipelineDef): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  await bridge.runPipeline({
    pipelineId: "test-1",
    pipeline,
    onEvent: (event) => events.push(event),
  });
  return events;
}

describe("KernelBridge", () => {
  it("emits executionStarted -> nodeCompleted x N -> pipelineCompleted for an ok pipeline", async () => {
    const { kernel } = fakeKernel([
      [
        { type: "iopub", msg: streamMsg("stdout", "hello\n") },
        { type: "reply", reply: { status: "ok" } },
      ],
      [
        { type: "iopub", msg: streamMsg("stdout", "world\n") },
        { type: "reply", reply: { status: "ok" } },
      ],
    ]);
    const bridge = new KernelBridge(kernel);
    const events = await collectEvents(bridge, linearPipeline());

    expect(events[0]?.type).toBe("executionStarted");
    const completed = events.filter((e) => e.type === "nodeCompleted");
    expect(completed.length).toBe(2);
    expect(events[events.length - 1]?.type).toBe("pipelineCompleted");
    if (completed[0]?.type === "nodeCompleted") {
      expect(completed[0].result.status).toBe("ok");
      expect(completed[0].result.outputs).toEqual([
        { output_type: "stream", name: "stdout", text: "hello\n" },
      ]);
    }
  });

  it("coalesces adjacent stdout chunks into a single stream output", async () => {
    const { kernel } = fakeKernel([
      [
        { type: "iopub", msg: streamMsg("stdout", "first ") },
        { type: "iopub", msg: streamMsg("stdout", "second\n") },
        { type: "reply", reply: { status: "ok" } },
        { type: "reply", reply: { status: "ok" } },
      ],
      [{ type: "reply", reply: { status: "ok" } }],
    ]);
    const bridge = new KernelBridge(kernel);
    const events = await collectEvents(bridge, linearPipeline());
    const first = events.find((e) => e.type === "nodeCompleted");
    if (first?.type !== "nodeCompleted") {
      throw new Error("expected at least one nodeCompleted event");
    }
    expect(first.result.outputs).toEqual([
      { output_type: "stream", name: "stdout", text: "first second\n" },
    ]);
  });

  it("marks downstream nodes as skipped after a kernel error", async () => {
    const { kernel } = fakeKernel([
      [
        { type: "iopub", msg: errorIOPub("RuntimeError", "boom") },
        { type: "reply", reply: { status: "error" } },
      ],
      // Second script is unused -- skipped node should not invoke kernel.
      [{ type: "reply", reply: { status: "ok" } }],
    ]);
    const bridge = new KernelBridge(kernel);
    const events = await collectEvents(bridge, linearPipeline());
    const completed = events.filter((e) => e.type === "nodeCompleted");
    expect(completed.length).toBe(2);
    if (completed[0]?.type === "nodeCompleted" && completed[1]?.type === "nodeCompleted") {
      expect(completed[0].result.status).toBe("error");
      expect(completed[0].result.error).toContain("RuntimeError");
      expect(completed[1].result.status).toBe("skipped");
      expect(completed[1].result.outputs).toEqual([]);
    }
  });

  it("emits an error event when no kernel is available", async () => {
    const bridge = new KernelBridge((): null => null);
    const events: EngineEvent[] = [];
    await bridge.runPipeline({
      pipelineId: "test-2",
      pipeline: linearPipeline(),
      onEvent: (event) => events.push(event),
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("error");
    if (events[0]?.type === "error") {
      expect(events[0].message).toContain("no active kernel");
    }
  });

  it("isReady reflects whether the resolver currently returns a kernel", () => {
    const ready = new KernelBridge({} as unknown as Kernel.IKernelConnection);
    expect(ready.isReady).toBe(true);

    let kernel: Kernel.IKernelConnection | null = null;
    const lazy = new KernelBridge((): Kernel.IKernelConnection | null => kernel);
    expect(lazy.isReady).toBe(false);
    kernel = {} as unknown as Kernel.IKernelConnection;
    expect(lazy.isReady).toBe(true);
  });

  it("respects topological order from edges, not insertion order", async () => {
    const { kernel, invocations } = fakeKernel([
      [{ type: "reply", reply: { status: "ok" } }],
      [{ type: "reply", reply: { status: "ok" } }],
      [{ type: "reply", reply: { status: "ok" } }],
    ]);
    const bridge = new KernelBridge(kernel);
    const pipeline: PipelineDef = {
      nodes: [
        // Deliberately out-of-order insertion: C declared before its inputs.
        {
          id: "c",
          name: "C",
          tag: "output",
          inputs: ["x<-B.x"],
          outputs: [],
          source: "code_c",
          notebookPath: "",
          cellIndices: [2],
        },
        {
          id: "a",
          name: "A",
          tag: "input",
          inputs: [],
          outputs: ["x"],
          source: "code_a",
          notebookPath: "",
          cellIndices: [0],
        },
        {
          id: "b",
          name: "B",
          tag: "transform",
          inputs: ["x<-A.x"],
          outputs: ["x"],
          source: "code_b",
          notebookPath: "",
          cellIndices: [1],
        },
      ],
      edges: [
        { sourceNodeId: "a", sourcePort: "x", targetNodeId: "b", targetPort: "x<-A.x" },
        { sourceNodeId: "b", sourcePort: "x", targetNodeId: "c", targetPort: "x<-B.x" },
      ],
    };
    await collectEvents(bridge, pipeline);
    expect(invocations.map((inv) => extractCellSourceFromWrapper(inv.code))).toEqual([
      "code_a",
      "code_b",
      "code_c",
    ]);
  });

  it("returns ok with no kernel invocation for nodes with empty source", async () => {
    const { kernel, invocations } = fakeKernel([]);
    const bridge = new KernelBridge(kernel);
    const events = await collectEvents(bridge, {
      nodes: [
        {
          id: "a",
          name: "A",
          tag: "input",
          inputs: [],
          outputs: [],
          source: "",
          notebookPath: "",
          cellIndices: [],
        },
      ],
      edges: [],
    });
    expect(invocations).toEqual([]);
    const completed = events.find((e) => e.type === "nodeCompleted");
    if (completed?.type === "nodeCompleted") {
      expect(completed.result.status).toBe("ok");
      expect(completed.result.outputs).toEqual([]);
    }
  });
});

// Silence unused-var lint -- vi.fn is exported here for future expansion.
void vi.fn;
