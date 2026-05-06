/**
 * Bidirectional sync subpackage.
 *
 * Re-exports the marker parser and the sync engine so platform adapters
 * can import them as `@notebookflow/graph-canvas/sync`.
 */

export { MarkerParser } from "./MarkerParser";
export type { NotebookCell, ParseError, ParseResult } from "./MarkerParser";

export { SyncEngine } from "./SyncEngine";
export type {
  CellPatch,
  ConflictResolution,
  SyncDirection,
  SyncEngineOptions,
  SyncEvent,
} from "./SyncEngine";
