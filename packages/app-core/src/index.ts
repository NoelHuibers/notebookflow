/**
 * @notebookflow/app-core
 *
 * Host-agnostic workspace core shared by the NotebookFlow surfaces (web app,
 * VS Code, JupyterLab): the engine client, the engine wire types, and pure
 * pipeline/event helpers. Hosts inject their own engine URL/token — nothing
 * in here reads a host environment.
 */

export { EngineClient } from "./EngineClient";
export {
  buildGenerationStatus,
  defaultEventLabels,
  type EventLabels,
  renderEvent,
  statusGlyph,
} from "./events";
export { buildPipelineDef, stripMarkerLine } from "./pipeline";
export type {
  AskAnswer,
  Credentials,
  DataFile,
  EdgeDef,
  EngineEvent,
  ExecutionResultMsg,
  NbOutput,
  NodeDef,
  PipelineDef,
  PipelineExplanation,
  PipelineProposal,
  PipelineProposalNode,
  RunOptions,
  TriggerFiring,
  TriggerKind,
  TriggerSpec,
} from "./types";
