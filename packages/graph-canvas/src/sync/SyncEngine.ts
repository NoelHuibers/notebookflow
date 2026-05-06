/**
 * SyncEngine — keeps the derived graph in sync with the source-of-truth notebooks.
 *
 * Direction of flow:
 *   - cell→graph: notebook saved → reparse markers → diff against current
 *     graph → emit GraphModel updates.
 *   - graph→cell: user renames a node or draws a wire on the canvas → engine
 *     computes the cell-source patch (insert, update, or delete `# @node:`
 *     marker line) and applies it via the platform's notebook API.
 *
 * Conflict policy: the cell editor always wins on a direct cell edit. If a
 * graph edit and a cell edit race, the most recent timestamp wins.
 */

import type { GraphModel } from "../types";
import type { NotebookCell } from "./MarkerParser";

export type SyncDirection = "cell-to-graph" | "graph-to-cell";

export type ConflictResolution = "cell-wins" | "graph-wins" | "timestamp";

export interface SyncEvent {
  direction: SyncDirection;
  notebookPath: string;
  /** Monotonic timestamp used for tie-breaking races. */
  timestamp: number;
}

/** Patch describing a write back to the notebook (consumed by the platform adapter). */
export interface CellPatch {
  notebookPath: string;
  cellIndex: number;
  /** New source for the cell, or null to delete the cell entirely. */
  newSource: string | null;
}

export interface SyncEngineOptions {
  conflictResolution?: ConflictResolution;
  /** Called when the engine wants the platform adapter to mutate a cell. */
  onCellPatch: (patch: CellPatch) => Promise<void>;
  /** Called when the engine has computed an updated graph model. */
  onGraphUpdate: (graph: GraphModel) => void;
}

export class SyncEngine {
  constructor(_opts: SyncEngineOptions) {
    // TODO: store options, init internal graph state + last-edit timestamps.
  }

  /** Cell→graph: invoked when a notebook file changes on disk or in the editor. */
  async ingestNotebook(
    _notebookPath: string,
    _cells: NotebookCell[],
    _timestamp: number,
  ): Promise<void> {
    // TODO: parse markers, reconcile with current graph, emit onGraphUpdate.
    throw new Error("SyncEngine.ingestNotebook: not implemented");
  }

  /** Graph→cell: rename a node and push the new marker line into its cell. */
  async renameNode(_nodeId: string, _nextName: string, _timestamp: number): Promise<void> {
    // TODO: find marker, format new line, emit onCellPatch.
    throw new Error("SyncEngine.renameNode: not implemented");
  }

  /** Graph→cell: persist a newly drawn wire by updating in/out lists in the markers. */
  async createWire(
    _sourceNodeId: string,
    _sourcePort: string,
    _targetNodeId: string,
    _targetPort: string,
    _timestamp: number,
  ): Promise<void> {
    // TODO: update both endpoints' markers via onCellPatch.
    throw new Error("SyncEngine.createWire: not implemented");
  }

  /** Snapshot of the current derived graph. */
  getGraph(): GraphModel {
    // TODO: return a defensive copy of internal state.
    throw new Error("SyncEngine.getGraph: not implemented");
  }
}
