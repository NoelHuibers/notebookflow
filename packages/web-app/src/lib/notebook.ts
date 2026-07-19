/**
 * Notebook helpers — parse and serialize nbformat-v4 documents.
 *
 * Used by the file picker (raw `.ipynb` text -> NotebookCell[]) and the
 * Download button (NotebookCell[] + the original metadata -> string ready
 * to drop into a Blob).
 */

import type { NotebookCell } from "@notebookflow/graph-canvas/sync";
import { triggerDownload } from "./download";
import type { NbOutput } from "./EngineClient";
import { LocalizableError } from "./errors";

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

interface RawNbOutput extends Record<string, unknown> {
  output_type?: unknown;
  name?: unknown;
  text?: unknown;
  data?: unknown;
  metadata?: unknown;
  ename?: unknown;
  evalue?: unknown;
  traceback?: unknown;
}

export function parseNotebook(text: string): ParsedNotebook {
  let doc: IpynbDoc;
  try {
    doc = JSON.parse(text) as IpynbDoc;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new LocalizableError("app.errors.notValidJson", { message });
  }
  if (!Array.isArray(doc.cells)) {
    throw new LocalizableError("app.errors.notNbformat");
  }
  const cells = doc.cells.map(toNotebookCell);
  return { cells, doc };
}

export function toNotebookCell(cell: IpynbCell): NotebookCell {
  const next = {
    cellType: normaliseCellType(cell.cell_type),
    source: Array.isArray(cell.source) ? cell.source.join("") : cell.source,
  };
  const metadata = cloneMetadata(cell.metadata);
  return metadata === undefined ? next : { ...next, metadata };
}

export function toIpynbCell(cell: NotebookCell): IpynbCell {
  return {
    cell_type: cell.cellType,
    source: splitSource(cell.source),
    metadata: cloneMetadata(cell.metadata) ?? {},
    ...(cell.cellType === "code" ? { execution_count: null, outputs: [] } : {}),
  };
}

export function extractOutputsByCell(doc: IpynbDoc): Record<number, NbOutput[]> {
  const outputsByCell: Record<number, NbOutput[]> = {};
  doc.cells.forEach((cell, index) => {
    if (cell.cell_type !== "code" || !Array.isArray(cell.outputs) || cell.outputs.length === 0) {
      return;
    }
    const outputs = cell.outputs.map(normalizeNbOutput).filter((output) => output !== null);
    if (outputs.length > 0) {
      outputsByCell[index] = outputs;
    }
  });
  return outputsByCell;
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
    metadata: cloneMetadata(updated.metadata) ?? cloneMetadata(base.metadata) ?? {},
    ...(updated.cellType === "code"
      ? {
          execution_count: base.execution_count ?? null,
          outputs: outputs ?? base.outputs ?? [],
        }
      : {}),
  };
}

function normalizeNbOutput(output: unknown): NbOutput | null {
  if (!isRawNbOutput(output)) {
    return null;
  }
  const outputType = output.output_type;
  if (outputType === "stream") {
    const name = output.name;
    const text = normalizeText(output.text);
    if ((name !== "stdout" && name !== "stderr") || text === null) {
      return null;
    }
    return { output_type: "stream", name, text };
  }
  if (outputType === "display_data" || outputType === "execute_result") {
    const data = normalizeMimeBundle(output.data);
    if (data === null) {
      return null;
    }
    return {
      output_type: outputType,
      data,
      metadata: isRecord(output.metadata) ? output.metadata : {},
    };
  }
  if (outputType === "error") {
    const ename = typeof output.ename === "string" ? output.ename : "";
    const evalue = typeof output.evalue === "string" ? output.evalue : "";
    const traceback = Array.isArray(output.traceback)
      ? output.traceback.filter((line): line is string => typeof line === "string")
      : [];
    return { output_type: "error", ename, evalue, traceback };
  }
  return null;
}

function normalizeMimeBundle(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) {
    return null;
  }
  const data: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const text = normalizeText(raw);
    if (text !== null) {
      data[key] = text;
    }
  }
  return Object.keys(data).length === 0 ? null : data;
}

function normalizeText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.every((part) => typeof part === "string")) {
    return value.join("");
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRawNbOutput(value: unknown): value is RawNbOutput {
  return isRecord(value);
}

/** nbformat stores source as an array of strings each ending with \n. */
function splitSource(source: string): string[] {
  if (source === "") {
    return [];
  }
  const lines = source.split("\n");
  return lines.map((line, idx) => (idx < lines.length - 1 ? `${line}\n` : line));
}

function cloneMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return metadata === undefined ? undefined : { ...metadata };
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
  const name = filename.endsWith(".ipynb") ? filename : `${filename}.ipynb`;
  triggerDownload(blob, name);
}
