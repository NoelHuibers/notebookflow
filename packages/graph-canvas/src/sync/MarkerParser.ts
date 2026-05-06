/**
 * MarkerParser — extracts `# @node` markers from notebook cells.
 *
 * Marker grammar (single line, must be first non-blank line of the cell):
 *
 *   # @node: <name>  [<tag>]                       — minimal form
 *   # @node: <name>  [<tag>]  in=a,b  out=df       — with declared ports
 *
 * The parser is forgiving: cells without a marker are simply ignored; cells
 * with a malformed marker yield a ParseError but never throw, so the whole
 * notebook can still be parsed even if one cell is broken.
 */

import type { NodeMarker, NodeTag } from "../types";

export interface ParseError {
  cellIndex: number;
  message: string;
  rawLine: string;
}

export interface ParseResult {
  markers: NodeMarker[];
  errors: ParseError[];
}

export interface NotebookCell {
  /** "code" cells are the only ones that can carry markers. */
  cellType: "code" | "markdown" | "raw";
  /** Source as a single string (notebook-spec joins arrays with ""). */
  source: string;
}

export class MarkerParser {
  /** Parse all cells in a notebook and return markers + any per-cell errors. */
  static parseNotebook(_notebookPath: string, _cells: NotebookCell[]): ParseResult {
    // TODO: iterate cells, look at first non-blank line, dispatch to parseLine.
    throw new Error("MarkerParser.parseNotebook: not implemented");
  }

  /** Parse a single line. Returns null if the line is not a marker. */
  static parseLine(_line: string): Omit<NodeMarker, "notebookPath" | "cellIndex"> | null {
    // TODO: match "# @node:" prefix, then extract name / tag / inputs / outputs.
    throw new Error("MarkerParser.parseLine: not implemented");
  }

  /** Render a marker back to a single-line `# @node:` string for cell injection. */
  static formatMarker(_marker: Omit<NodeMarker, "notebookPath" | "cellIndex">): string {
    // TODO: inverse of parseLine. Used by SyncEngine when graph edits push back to cells.
    throw new Error("MarkerParser.formatMarker: not implemented");
  }

  /** Validate a tag string. */
  static isValidTag(_tag: string): _tag is NodeTag {
    // TODO: check membership in the NodeTag union.
    throw new Error("MarkerParser.isValidTag: not implemented");
  }
}
