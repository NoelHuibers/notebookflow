/**
 * MarkerParser — extracts `# @node` markers from notebook cells.
 *
 * Marker grammar (single line, must be first non-blank line of the cell):
 *
 *   # @node: <name>  [<tag>]                       — minimal form
 *   # @node: <name>  [<tag>]  in=a.x,b.y  out=df   — with declared refs/ports
 *
 * A notebook may also declare an alias for cross-notebook references:
 *
 *   # @notebook: <alias>                            — header marker (any cell)
 *
 * Charset rules:
 *   - <name>      : [A-Za-z0-9 _-]+ trimmed; terminates at the first '['.
 *   - <tag>       : one of input | transform | output | ai | io.
 *   - in= refs    : comma-separated refs, each `nodeName.portName` (local) or
 *                   `alias:nodeName.portName` (cross-notebook, see #18).
 *   - out= names  : comma-separated bare portName entries.
 *   - portName    : [a-z][a-z0-9_]*.
 *   - alias       : [a-z][a-z0-9_-]*.
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
  /**
   * The notebook's alias for cross-notebook references — the explicit
   * `# @notebook:` value when present, otherwise the sanitised filename stem.
   */
  alias: string;
}

/** A parsed `in=` reference: local (alias === null) or alias-qualified. */
export interface ParsedRef {
  alias: string | null;
  nodeName: string;
  portName: string;
}

export interface NotebookCell {
  /** "code" cells are the only ones that can carry markers. */
  cellType: "code" | "markdown" | "raw";
  /** Source as a single string (notebook-spec joins arrays with ""). */
  source: string;
  /** Notebook-native metadata preserved across parse / serialize cycles. */
  metadata?: Record<string, unknown>;
}

class MarkerParseError extends Error {}

type MarkerBody = Omit<NodeMarker, "notebookPath" | "cellIndex">;

const TAGS = ["input", "transform", "output", "ai", "io"] as const satisfies readonly NodeTag[];
const NAME_RE = /^[A-Za-z0-9 _-]+$/;
const PORT_RE = /^[a-z][a-z0-9_]*$/;
const ALIAS_RE = /^[a-z][a-z0-9_-]*$/;
const MARKER_PREFIX_RE = /^#\s+@node:/;
const MARKER_RE = /^#\s+@node:\s*([^[]*)\[([^\]]+)\]\s*(.*)$/;
const NOTEBOOK_PREFIX_RE = /^#\s+@notebook:/;
const NOTEBOOK_RE = /^#\s+@notebook:\s*(\S+)\s*$/;

export class MarkerParser {
  /** Parse all cells in a notebook and return markers + any per-cell errors. */
  static parseNotebook(notebookPath: string, cells: NotebookCell[]): ParseResult {
    const markers: NodeMarker[] = [];
    const errors: ParseError[] = [];
    let declaredAlias: string | null = null;

    for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
      const cell = cells[cellIndex];
      if (cell?.cellType !== "code") {
        continue;
      }

      const firstLine = firstNonBlankLine(cell.source);
      if (firstLine === null) {
        continue;
      }

      // A `# @notebook:` header declares the notebook's alias. It is not a
      // node; the first valid declaration wins.
      if (NOTEBOOK_PREFIX_RE.test(firstLine.trim())) {
        try {
          const alias = MarkerParser.parseNotebookLine(firstLine);
          if (alias !== null && declaredAlias === null) {
            declaredAlias = alias;
          }
        } catch (err: unknown) {
          const message = err instanceof MarkerParseError ? err.message : "Unknown parse error";
          errors.push({ cellIndex, message, rawLine: firstLine });
        }
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

    return { markers, errors, alias: declaredAlias ?? defaultAliasForPath(notebookPath) };
  }

  /** Parse a `# @notebook: <alias>` header. Returns null if not such a line. */
  static parseNotebookLine(line: string): string | null {
    const trimmed = line.trim();
    if (!NOTEBOOK_PREFIX_RE.test(trimmed)) {
      return null;
    }
    const match = NOTEBOOK_RE.exec(trimmed);
    if (match === null) {
      throw new MarkerParseError("Malformed @notebook marker: expected `# @notebook: <alias>`");
    }
    const alias = (match[1] ?? "").trim();
    if (!ALIAS_RE.test(alias)) {
      throw new MarkerParseError(`Invalid notebook alias: ${JSON.stringify(alias)}`);
    }
    return alias;
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

  /** Render a `# @notebook: <alias>` header line. */
  static formatNotebookMarker(alias: string): string {
    return `# @notebook: ${alias}`;
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
    // Re-serialise via parseRef so the stored string is normalised and any
    // structural error is surfaced here at parse time.
    const parsed = parseRefOrThrow(ref);
    return formatRef(parsed);
  });
}

/**
 * Split an `in=` reference into its alias (or null), node name, and port.
 * Cross-notebook refs are `alias:NodeName.port`; local refs are
 * `NodeName.port`. Returns null when the ref is structurally invalid — the
 * SyncEngine treats that as an unresolved wire rather than throwing.
 */
export function parseRef(ref: string): ParsedRef | null {
  try {
    return parseRefOrThrow(ref);
  } catch {
    return null;
  }
}

/** Serialise a ParsedRef back to its canonical `alias:Node.port` / `Node.port` form. */
export function formatRef(ref: ParsedRef): string {
  const local = `${ref.nodeName}.${ref.portName}`;
  return ref.alias === null ? local : `${ref.alias}:${local}`;
}

/** Derive a notebook alias from its path: the lowercased, sanitised stem. */
export function defaultAliasForPath(notebookPath: string): string {
  const base = notebookPath.split(/[\\/]/).pop() ?? notebookPath;
  const stem = base.replace(/\.ipynb$/i, "");
  const sanitised = stem.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  // Aliases must start with [a-z]; prefix when the stem begins with a digit
  // or separator so it stays a valid identifier.
  return /^[a-z]/.test(sanitised) ? sanitised : `nb_${sanitised}`;
}

function parseRefOrThrow(ref: string): ParsedRef {
  const colonIdx = ref.indexOf(":");
  let alias: string | null = null;
  let rest = ref;
  if (colonIdx !== -1) {
    alias = ref.slice(0, colonIdx).trim();
    rest = ref.slice(colonIdx + 1).trim();
    if (!ALIAS_RE.test(alias)) {
      throw new MarkerParseError(`Invalid alias in ref: ${JSON.stringify(alias)}`);
    }
  }
  const dotIdx = rest.lastIndexOf(".");
  if (dotIdx === -1) {
    throw new MarkerParseError(`Input ref ${JSON.stringify(ref)} must be nodeName.portName`);
  }
  const nodeName = rest.slice(0, dotIdx).trim();
  const portName = rest.slice(dotIdx + 1).trim();
  if (nodeName === "" || !NAME_RE.test(nodeName)) {
    throw new MarkerParseError(`Invalid nodeName in ref: ${JSON.stringify(nodeName)}`);
  }
  if (!PORT_RE.test(portName)) {
    throw new MarkerParseError(`Invalid portName in ref: ${JSON.stringify(portName)}`);
  }
  return { alias, nodeName, portName };
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
