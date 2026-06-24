/**
 * Shared workspace types used across App and the extracted modules.
 */

import type { NotebookCell } from "@notebookflow/graph-canvas/sync";

import type { IpynbDoc } from "@/lib/notebook";

export interface LoadedNotebook {
  name: string;
  cells: NotebookCell[];
  doc: IpynbDoc;
}

/** A file open in the workspace. The active file's live content lives in the
 * `notebook` state; this carries the rail's identity (id + name). */
export interface OpenFileMeta {
  id: string;
  name: string;
}

/** Frozen editing state of an inactive open file, kept in a ref until it's
 * switched back to. */
export interface FileSnapshot {
  cells: NotebookCell[];
  doc: IpynbDoc;
  baseline: string[];
  fileHandle: FileSystemFileHandle | null;
}

export type DragAxis = "horizontal" | "vertical";

export interface DragState {
  axis: DragAxis;
  startCoord: number;
  startRatio: number;
}
