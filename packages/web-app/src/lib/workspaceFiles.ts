/**
 * Pure helpers for the multi-file workspace: file ids, blank/initial notebook
 * construction, workspace-filename detection, and output-index math shared by
 * the cell operations and the useWorkspaceFiles hook.
 */

import type { NotebookCell } from "@notebookflow/graph-canvas/sync";

import { bootstrapNotebookFixtures } from "@/lib/bootstrap";
import { toIpynbCell } from "@/lib/notebook";
import type { CellOutputsByCell, LoadedNotebook, OpenFileMeta } from "@/types/workspace";

export function makeFileId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `file-${String(Math.floor(performance.now() * 1000))}`;
}

export function uniqueUntitledNotebookName(files: OpenFileMeta[]): string {
  const used = new Set(files.map((file) => file.name));
  if (!used.has("Untitled.ipynb")) {
    return "Untitled.ipynb";
  }
  let suffix = 2;
  let candidate = `Untitled ${String(suffix)}.ipynb`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `Untitled ${String(suffix)}.ipynb`;
  }
  return candidate;
}

export function createBlankNotebook(name: string): LoadedNotebook {
  const cells: NotebookCell[] = [{ cellType: "code", source: "" }];
  return {
    name,
    cells,
    doc: {
      cells: cells.map((cell) => toIpynbCell(cell)),
      metadata: {
        kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      },
      nbformat: 4,
      nbformat_minor: 5,
    },
  };
}

export interface InitialWorkspaceFile {
  id: string;
  notebook: LoadedNotebook;
}

export function createInitialWorkspaceFiles(): InitialWorkspaceFile[] {
  const notebooks = bootstrapNotebookFixtures();
  if (notebooks.length === 0) {
    return [{ id: makeFileId(), notebook: createBlankNotebook("preprocessing.ipynb") }];
  }
  return notebooks.map((notebook) => ({ id: makeFileId(), notebook }));
}

export function firstInitialWorkspaceFile(files: InitialWorkspaceFile[]): InitialWorkspaceFile {
  const first = files[0];
  if (first === undefined) {
    throw new Error("Initial workspace must contain at least one notebook");
  }
  return first;
}

export function shiftOutputsAfterDelete(
  outputs: CellOutputsByCell,
  deletedIndex: number,
): CellOutputsByCell {
  const next: CellOutputsByCell = {};
  for (const [key, value] of Object.entries(outputs)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index === deletedIndex) {
      continue;
    }
    next[index > deletedIndex ? index - 1 : index] = value;
  }
  return next;
}

export function shiftOutputsAfterInsert(
  outputs: CellOutputsByCell,
  insertedIndex: number,
): CellOutputsByCell {
  const next: CellOutputsByCell = {};
  for (const [key, value] of Object.entries(outputs)) {
    const index = Number(key);
    if (!Number.isInteger(index)) {
      continue;
    }
    next[index >= insertedIndex ? index + 1 : index] = value;
  }
  return next;
}

export function isLikelyWorkspaceFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".notebookflow.json") ||
    lower.endsWith(".notebookflow") ||
    lower.endsWith(".nfw")
  );
}
