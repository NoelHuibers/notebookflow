/**
 * @notebookflow/app-core
 *
 * Host-agnostic workspace core shared by the NotebookFlow surfaces (web app,
 * VS Code, JupyterLab): the engine client, the engine wire types, pure
 * pipeline/event helpers, and shared React components. Hosts inject their own
 * engine URL/token and translated labels — nothing in here reads a host
 * environment, and every user-facing string has an English default a host can
 * override via a `labels` prop/argument.
 */

export {
  AskPalette,
  type AskPaletteLabels,
  type AskPaletteProps,
  defaultAskPaletteLabels,
} from "./components/AskPalette";
export {
  CellOutputs,
  type CellOutputsLabels,
  type CellOutputsProps,
  defaultCellOutputsLabels,
} from "./components/CellOutputs";
export {
  ComposeDialog,
  type ComposeDialogLabels,
  type ComposeDialogProps,
  defaultComposeDialogLabels,
} from "./components/ComposeDialog";
export {
  defaultExplanationPanelLabels,
  ExplanationPanel,
  type ExplanationPanelLabels,
  type ExplanationPanelProps,
} from "./components/ExplanationPanel";
export { EngineClient } from "./EngineClient";
export {
  buildGenerationStatus,
  defaultEventLabels,
  type EventLabels,
  renderEvent,
  statusGlyph,
} from "./events";
export {
  OUTPUT_HTML_ALLOWED_ATTR,
  OUTPUT_HTML_ALLOWED_TAGS,
  sanitizeOutputHtml,
} from "./outputHtml";
export { buildPipelineDef, stripMarkerLine } from "./pipeline";
export { extractSourceFilename } from "./sourceMeta";
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
