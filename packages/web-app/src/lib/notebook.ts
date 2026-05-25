/**
 * Notebook helpers — parse and serialize nbformat-v4 documents.
 *
 * Used by the file picker (raw `.ipynb` text -> NotebookCell[]) and the
 * Download button (NotebookCell[] + the original metadata -> string ready
 * to drop into a Blob).
 */

import type { NotebookCell } from "@notebookflow/graph-canvas/sync";

import type { NbOutput } from "./EngineClient";

export interface IpynbCell {
  cell_type: string;
  source: string | string[];
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  outputs?: unknown[];
}

export interface IpynbDoc {
  cells: IpynbCell[];
  metadata?: Record<string, unknown>;
  nbformat?: number;
  nbformat_minor?: number;
}

export interface ParsedNotebook {
  cells: NotebookCell[];
  doc: IpynbDoc;
}

export function parseNotebook(text: string): ParsedNotebook {
  let doc: IpynbDoc;
  try {
    doc = JSON.parse(text) as IpynbDoc;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new Error(`Not valid JSON: ${message}`);
  }
  if (!Array.isArray(doc.cells)) {
    throw new Error("Not an nbformat document (missing `cells` array)");
  }
  const cells = doc.cells.map(toNotebookCell);
  return { cells, doc };
}

export function toNotebookCell(cell: IpynbCell): NotebookCell {
  return {
    cellType: normaliseCellType(cell.cell_type),
    source: Array.isArray(cell.source) ? cell.source.join("") : cell.source,
  };
}

function normaliseCellType(kind: string): NotebookCell["cellType"] {
  if (kind === "code") {
    return "code";
  }
  if (kind === "markdown") {
    return "markdown";
  }
  return "raw";
}

/**
 * Serialize the current cell state back into nbformat-v4 JSON for download.
 *
 * If `outputsByCell` is provided, each code cell's outputs are replaced with
 * the captured outputs from the most recent run -- so a Downloaded notebook
 * contains real results, not stale ones from the source file.
 */
export function serializeNotebook(
  cells: NotebookCell[],
  original: IpynbDoc,
  outputsByCell: Record<number, NbOutput[]> = {},
): string {
  const merged: IpynbDoc = {
    ...original,
    cells: cells.map((cell, idx) => mergeCell(cell, original.cells[idx], outputsByCell[idx])),
    nbformat: original.nbformat ?? 4,
    nbformat_minor: original.nbformat_minor ?? 5,
  };
  if (!merged.metadata) {
    merged.metadata = {};
  }
  return JSON.stringify(merged, null, 1);
}

function mergeCell(updated: NotebookCell, original?: IpynbCell, outputs?: NbOutput[]): IpynbCell {
  const base: IpynbCell = original ?? {
    cell_type: updated.cellType,
    source: [],
    metadata: {},
  };
  return {
    ...base,
    cell_type: updated.cellType,
    source: splitSource(updated.source),
    ...(updated.cellType === "code"
      ? {
          execution_count: base.execution_count ?? null,
          outputs: outputs ?? base.outputs ?? [],
        }
      : {}),
  };
}

/** nbformat stores source as an array of strings each ending with \n. */
function splitSource(source: string): string[] {
  if (source === "") {
    return [];
  }
  const lines = source.split("\n");
  return lines.map((line, idx) => (idx < lines.length - 1 ? `${line}\n` : line));
}

/** Build a Blob and trigger a browser download of the assembled notebook. */
export function downloadNotebook(
  cells: NotebookCell[],
  doc: IpynbDoc,
  filename: string,
  outputsByCell: Record<number, NbOutput[]> = {},
): void {
  const json = serializeNotebook(cells, doc, outputsByCell);
  const blob = new Blob([json], { type: "application/x-ipynb+json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(".ipynb") ? filename : `${filename}.ipynb`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
