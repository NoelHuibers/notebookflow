/**
 * Wire/data types shared between the engine and every host surface (web app,
 * VS Code, JupyterLab). These mirror the engine's REST + WebSocket payloads;
 * keep them in sync with `engine/notebookflow/server.py`.
 */

export interface NodeDef {
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

export interface EdgeDef {
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

export interface RunOptions {
  pipelineId: string;
  pipeline: PipelineDef;
  onEvent: (event: EngineEvent) => void;
  url?: string;
}

export interface Credentials {
  provider: string;
  model: string;
  apiKey: string;
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

export interface DataFile {
  name: string;
  size: number;
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
