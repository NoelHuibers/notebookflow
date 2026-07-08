/**
 * Bidirectional sync subpackage.
 *
 * Re-exports the marker parser and the sync engine so platform adapters
 * can import them as `@notebookflow/graph-canvas/sync`.
 */

export type {
  NotebookCell,
  ParsedInputBinding,
  ParsedRef,
  ParseError,
  ParseResult,
} from "./MarkerParser";
export { formatInputBinding, MarkerParser, parseInputBinding, parseRef } from "./MarkerParser";
export type {
  CellPatch,
  ConflictResolution,
  CreateNodeOptions,
  SyncDirection,
  SyncEngineOptions,
  SyncEvent,
  UpdateNodeContentsOptions,
} from "./SyncEngine";
export { SyncEngine } from "./SyncEngine";
