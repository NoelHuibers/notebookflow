import type { CellPatch } from "@notebookflow/graph-canvas/sync";

import type { FileSnapshot, OpenFileMeta } from "@/types/workspace";

import { applyCellPatch } from "./cellPatch";

export type WorkspacePatchTarget =
  | { kind: "active" }
  | { kind: "snapshot"; fileId: string; name: string; snapshot: FileSnapshot }
  | { kind: "missing" };

export interface WorkspacePatchLookup {
  openFiles: OpenFileMeta[];
  activeFileId: string;
  activeNotebookName: string;
  snapshots: Map<string, FileSnapshot>;
}

export function resolveWorkspacePatchTarget(
  lookup: WorkspacePatchLookup,
  notebookPath: string,
): WorkspacePatchTarget {
  const activeFile = lookup.openFiles.find((file) => file.id === lookup.activeFileId);
  if (notebookPath === lookup.activeNotebookName || notebookPath === activeFile?.name) {
    return { kind: "active" };
  }

  const targetFile = lookup.openFiles.find((file) => file.name === notebookPath);
  if (targetFile === undefined) {
    return { kind: "missing" };
  }

  const snapshot = lookup.snapshots.get(targetFile.id);
  if (snapshot === undefined) {
    return { kind: "missing" };
  }

  return { kind: "snapshot", fileId: targetFile.id, name: targetFile.name, snapshot };
}

export function applyPatchToSnapshot(
  snapshot: FileSnapshot,
  name: string,
  patch: CellPatch,
): FileSnapshot {
  const patched = applyCellPatch({ name, cells: snapshot.cells, doc: snapshot.doc }, patch);
  return { ...snapshot, cells: patched.cells, doc: patched.doc };
}
