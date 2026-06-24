/**
 * Cell-patch application — fold a SyncEngine CellPatch into the loaded
 * notebook's cells and backing ipynb doc.
 */

import type { CellPatch, NotebookCell } from "@notebookflow/graph-canvas/sync";

import type { LoadedNotebook } from "@/types/workspace";

import { toIpynbCell } from "./notebook";

export function applyCellPatch(prev: LoadedNotebook, patch: CellPatch): LoadedNotebook {
  if (patch.operation === "insert") {
    if (patch.newSource === null || patch.cellIndex < 0 || patch.cellIndex > prev.cells.length) {
      return prev;
    }
    const nextCell: NotebookCell = {
      cellType: patch.cellType ?? "code",
      source: patch.newSource,
      ...(patch.metadata === undefined ? {} : { metadata: patch.metadata }),
    };
    const nextCells = prev.cells.slice();
    nextCells.splice(patch.cellIndex, 0, nextCell);
    const nextDocCells = prev.doc.cells.slice();
    nextDocCells.splice(patch.cellIndex, 0, toIpynbCell(nextCell));
    return { ...prev, cells: nextCells, doc: { ...prev.doc, cells: nextDocCells } };
  }

  if (patch.operation === "delete") {
    if (patch.cellIndex < 0 || patch.cellIndex >= prev.cells.length) {
      return prev;
    }
    const nextCells = prev.cells.slice();
    nextCells.splice(patch.cellIndex, 1);
    const nextDocCells = prev.doc.cells.slice();
    nextDocCells.splice(patch.cellIndex, 1);
    return { ...prev, cells: nextCells, doc: { ...prev.doc, cells: nextDocCells } };
  }

  if (patch.cellIndex < 0 || patch.cellIndex >= prev.cells.length || patch.newSource === null) {
    return prev;
  }
  const cell = prev.cells[patch.cellIndex];
  const docCell = prev.doc.cells[patch.cellIndex];
  if (cell === undefined || docCell === undefined) {
    return prev;
  }
  const nextMetadata = patch.metadata ?? cell.metadata;
  if (cell.source === patch.newSource && nextMetadata === cell.metadata) {
    return prev;
  }
  const nextCells = prev.cells.slice();
  nextCells[patch.cellIndex] = {
    ...cell,
    source: patch.newSource,
    ...(nextMetadata === undefined ? {} : { metadata: nextMetadata }),
  };
  const nextDocCells = prev.doc.cells.slice();
  nextDocCells[patch.cellIndex] = {
    ...docCell,
    source: [patch.newSource],
    metadata: nextMetadata ?? docCell.metadata ?? {},
  };
  return { ...prev, cells: nextCells, doc: { ...prev.doc, cells: nextDocCells } };
}
