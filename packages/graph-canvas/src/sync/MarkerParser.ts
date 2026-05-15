/**
 * MarkerParser — extracts `# @node` markers from notebook cells.
 *
 * Marker grammar (single line, must be first non-blank line of the cell):
 *
 *   # @node: <name>  [<tag>]                       — minimal form
 *   # @node: <name>  [<tag>]  in=a.x,b.y  out=df   — with declared refs/ports
 *
 * Charset rules:
 *   - <name>      : [A-Za-z0-9 _-]+ trimmed; terminates at the first '['.
 *   - <tag>       : one of input | transform | output | ai | io.
 *   - in= refs    : comma-separated nodeName.portName entries.
 *   - out= names  : comma-separated bare portName entries.
 *   - portName    : [a-z][a-z0-9_]*.
 *
 * The parser is forgiving: cells without a marker are simply ignored; cells
 * with a malformed marker yield a ParseError but never throw out of
 * parseNotebook, so the whole notebook can still be parsed even if one cell
 * is broken. parseLine itself throws on malformed markers; parseNotebook
 * catches and routes them into ParseResult.errors.
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

class MarkerParseError extends Error {}

type MarkerBody = Omit<NodeMarker, "notebookPath" | "cellIndex">;

const TAGS = ["input", "transform", "output", "ai", "io"] as const satisfies readonly NodeTag[];
const NAME_RE = /^[A-Za-z0-9 _-]+$/;
const PORT_RE = /^[a-z][a-z0-9_]*$/;
const MARKER_PREFIX_RE = /^#\s+@node:/;
const MARKER_RE = /^#\s+@node:\s*([^[]*)\[([^\]]+)\]\s*(.*)$/;

export class MarkerParser {
  /** Parse all cells in a notebook and return markers + any per-cell errors. */
  static parseNotebook(notebookPath: string, cells: NotebookCell[]): ParseResult {
    const markers: NodeMarker[] = [];
    const errors: ParseError[] = [];

    for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
      const cell = cells[cellIndex];
      if (cell?.cellType !== "code") {
        continue;
      }

      const firstLine = firstNonBlankLine(cell.source);
      if (firstLine === null) {
        continue;
      }

      try {
        const body = MarkerParser.parseLine(firstLine);
        if (body === null) {
          continue;
        }
        markers.push({ ...body, notebookPath, cellIndex });
      } catch (err: unknown) {
        const message = err instanceof MarkerParseError ? err.message : "Unknown parse error";
        errors.push({ cellIndex, message, rawLine: firstLine });
      }
    }

    return { markers, errors };
  }

  /** Parse a single line. Returns null if the line is not a marker. */
  static parseLine(line: string): MarkerBody | null {
    const trimmed = line.trim();
    if (!MARKER_PREFIX_RE.test(trimmed)) {
      return null;
    }

    const match = MARKER_RE.exec(trimmed);
    if (match === null) {
      throw new MarkerParseError("Malformed @node marker: expected `# @node: <name> [<tag>] ...`");
    }

    const rawName = (match[1] ?? "").trim();
    const rawTag = (match[2] ?? "").trim();
    const tail = (match[3] ?? "").trim();

    if (rawName === "") {
      throw new MarkerParseError("Marker name is empty");
    }
    if (!NAME_RE.test(rawName)) {
      throw new MarkerParseError(`Invalid marker name: ${JSON.stringify(rawName)}`);
    }
    if (!MarkerParser.isValidTag(rawTag)) {
      throw new MarkerParseError(`Invalid tag: ${JSON.stringify(rawTag)}`);
    }

    const { inputs, outputs } = parseTail(tail);

    return { name: rawName, tag: rawTag, inputs, outputs };
  }

  /** Render a marker back to a single-line `# @node:` string for cell injection. */
  static formatMarker(marker: MarkerBody): string {
    const parts = [`# @node: ${marker.name}`, `[${marker.tag}]`];
    if (marker.inputs.length > 0) {
      parts.push(`in=${marker.inputs.join(",")}`);
    }
    if (marker.outputs.length > 0) {
      parts.push(`out=${marker.outputs.join(",")}`);
    }
    return parts.join("  ");
  }

  /** Validate a tag string. */
  static isValidTag(tag: string): tag is NodeTag {
    return (TAGS as readonly string[]).includes(tag);
  }
}

function firstNonBlankLine(source: string): string | null {
  const lines = source.split("\n");
  for (const line of lines) {
    if (line.trim() !== "") {
      return line;
    }
  }
  return null;
}

function parseTail(tail: string): { inputs: string[]; outputs: string[] } {
  if (tail === "") {
    return { inputs: [], outputs: [] };
  }

  const inIdx = tail.search(/\bin=/);
  const outIdx = tail.search(/\bout=/);

  if (inIdx === -1 && outIdx === -1) {
    throw new MarkerParseError(`Unrecognized trailing content: ${JSON.stringify(tail)}`);
  }

  interface Slot {
    kind: "in" | "out";
    keyStart: number;
    valueStart: number;
  }
  const slots: Slot[] = [];
  if (inIdx !== -1) {
    slots.push({ kind: "in", keyStart: inIdx, valueStart: inIdx + 3 });
  }
  if (outIdx !== -1) {
    slots.push({ kind: "out", keyStart: outIdx, valueStart: outIdx + 4 });
  }
  slots.sort((a, b) => a.keyStart - b.keyStart);

  const first = slots[0];
  if (first === undefined) {
    throw new MarkerParseError("Internal: no slots");
  }
  if (first.keyStart > 0) {
    const leading = tail.slice(0, first.keyStart).trim();
    if (leading !== "") {
      throw new MarkerParseError(
        `Unrecognized content before in=/out=: ${JSON.stringify(leading)}`,
      );
    }
  }

  let inputs: string[] = [];
  let outputs: string[] = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot === undefined) {
      continue;
    }
    const next = slots[i + 1];
    const valueEnd = next === undefined ? tail.length : next.keyStart;
    const value = tail.slice(slot.valueStart, valueEnd).trim();
    if (slot.kind === "in") {
      inputs = parseInputRefs(value);
    } else {
      outputs = parsePortNames(value);
    }
  }

  return { inputs, outputs };
}

function parseInputRefs(value: string): string[] {
  if (value === "") {
    return [];
  }
  return value.split(",").map((raw) => {
    const ref = raw.trim();
    if (ref === "") {
      throw new MarkerParseError("Empty input ref");
    }
    const dotIdx = ref.lastIndexOf(".");
    if (dotIdx === -1) {
      throw new MarkerParseError(`Input ref ${JSON.stringify(ref)} must be nodeName.portName`);
    }
    const nodeName = ref.slice(0, dotIdx).trim();
    const portName = ref.slice(dotIdx + 1).trim();
    if (nodeName === "" || !NAME_RE.test(nodeName)) {
      throw new MarkerParseError(`Invalid nodeName in ref: ${JSON.stringify(nodeName)}`);
    }
    if (!PORT_RE.test(portName)) {
      throw new MarkerParseError(`Invalid portName in ref: ${JSON.stringify(portName)}`);
    }
    return `${nodeName}.${portName}`;
  });
}

function parsePortNames(value: string): string[] {
  if (value === "") {
    return [];
  }
  return value.split(",").map((raw) => {
    const name = raw.trim();
    if (!PORT_RE.test(name)) {
      throw new MarkerParseError(`Invalid output port name: ${JSON.stringify(name)}`);
    }
    return name;
  });
}
