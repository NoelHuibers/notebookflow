/**
 * MarkerParser — extracts `# @node` markers from notebook cells.
 *
 * Two equivalent grammars are accepted on parse (#51). The `# @node:` line must
 * be the first non-blank line of the cell either way.
 *
 * Single-line (canonical — what we EMIT):
 *
 *   # @node: <name>  [<tag>]                       — minimal form
 *   # @node: <name>  [<tag>]  in=x<-A.y  out=df    — with declared bindings/ports
 *
 * Multi-line (also ACCEPTED — the tag may move to `# @tag:`, and refs/ports to
 * their own continuation comment lines immediately following `# @node:`):
 *
 *   # @node: <name>
 *   # @inputs: x<-A.y          (alias: # @in:)
 *   # @outputs: df             (alias: # @out:)
 *   # @tag: <tag>
 *
 * Decision (#51): liberal in, conservative out — accept both forms, but
 * normalise to the single-line form on emit (SyncEngine rewrites the whole
 * marker block to one line). Inline values on the `# @node:` line win over
 * continuation lines when both are present.
 *
 * A notebook may also declare an alias for cross-notebook references:
 *
 *   # @notebook: <alias>                            — header marker (any cell)
 *
 * Charset rules:
 *   - <name>      : [A-Za-z0-9 _-]+ trimmed; terminates at the first '['.
 *   - <tag>       : one of input | transform | output | ai | io.
 *   - in= bindings: comma-separated `localName<-nodeName.portName` entries.
 *                   Source refs may be qualified as `localName<-alias:nodeName.portName`.
 *   - out= names  : comma-separated bare portName entries.
 *   - portName    : [a-z][a-z0-9_]*.
 *   - alias       : [a-z][a-z0-9_-]*.
 *
 * The parser is forgiving: cells without a marker are simply ignored; cells
 * with a malformed marker yield a ParseError but never throw out of
 * parseNotebook, so the whole notebook can still be parsed even if one cell
 * is broken. parseMarkerBlock itself throws on malformed markers; parseNotebook
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

/** A parsed source reference: local (alias === null) or alias-qualified. */
export interface ParsedRef {
  alias: string | null;
  nodeName: string;
  portName: string;
}

/** A parsed input binding: inject source ref value into the local variable. */
export interface ParsedInputBinding {
  localName: string;
  source: ParsedRef;
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
// Continuation comment lines for the multi-line form, e.g. `# @inputs: x<-A.y`.
const CONTINUATION_RE = /^#\s+@(inputs|in|outputs|out|tag)\s*:\s*(.*)$/;
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
        const body = MarkerParser.parseMarkerBlock(leadingMarkerBlock(cell.source));
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

  /** Parse a single marker line (no continuation lines). Kept for callers /
   * tests that have one line; delegates to parseMarkerBlock. */
  static parseLine(line: string): MarkerBody | null {
    return MarkerParser.parseMarkerBlock([line]);
  }

  /**
   * Parse a marker block: the `# @node:` line plus any following multi-line
   * continuation comment lines. Returns null if the first line is not a `@node`
   * marker; throws MarkerParseError on a malformed one.
   */
  static parseMarkerBlock(lines: string[]): MarkerBody | null {
    const first = lines[0];
    if (first === undefined || !MARKER_PREFIX_RE.test(first.trim())) {
      return null;
    }

    const node = parseNodeLine(first.trim());
    let tag: string | null = node.tag;
    let inputs = node.inputs;
    let outputs = node.outputs;

    // Continuation lines fill any value the `# @node:` line did not provide.
    for (let i = 1; i < lines.length; i++) {
      const cont = parseContinuationLine((lines[i] ?? "").trim());
      if (cont === null) {
        continue;
      }
      if (cont.kind === "tag") {
        tag = tag ?? cont.value;
      } else if (cont.kind === "inputs") {
        inputs = inputs.length > 0 ? inputs : parseInputRefs(cont.value);
      } else {
        outputs = outputs.length > 0 ? outputs : parsePortNames(cont.value);
      }
    }

    if (tag === null || tag === "") {
      throw new MarkerParseError("Marker is missing a tag (use `[tag]` or `# @tag: <tag>`)");
    }
    if (!MarkerParser.isValidTag(tag)) {
      throw new MarkerParseError(`Invalid tag: ${JSON.stringify(tag)}`);
    }

    return { name: node.name, tag, inputs, outputs };
  }

  /** True for a multi-line continuation comment (`# @inputs:` / `@outputs:` /
   * `@tag:`). Used on emit to strip the block down to a single line. */
  static isContinuationLine(line: string): boolean {
    return CONTINUATION_RE.test(line.trim());
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

/** The leading marker block of a cell: the first non-blank line plus any
 * immediately-following continuation comment lines. */
function leadingMarkerBlock(source: string): string[] {
  const lines = source.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i] ?? "").trim() === "") {
    i++;
  }
  const head = lines[i];
  if (head === undefined) {
    return [];
  }
  const block = [head];
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j] ?? "";
    if (CONTINUATION_RE.test(line.trim())) {
      block.push(line);
    } else {
      break;
    }
  }
  return block;
}

/** Parse the `# @node:` line: name, an optional inline `[tag]`, and an optional
 * `in=`/`out=` tail. The tag is null when not given inline. */
function parseNodeLine(trimmed: string): {
  name: string;
  tag: string | null;
  inputs: string[];
  outputs: string[];
} {
  const afterPrefix = trimmed.replace(MARKER_PREFIX_RE, "").trim();
  let name: string;
  let tag: string | null = null;
  let tail = "";

  const open = afterPrefix.indexOf("[");
  if (open !== -1) {
    const close = afterPrefix.indexOf("]", open);
    if (close === -1) {
      throw new MarkerParseError("Malformed @node marker: unclosed [tag]");
    }
    name = afterPrefix.slice(0, open).trim();
    tag = afterPrefix.slice(open + 1, close).trim();
    tail = afterPrefix.slice(close + 1).trim();
  } else {
    const kv = afterPrefix.search(/\b(?:in|out)=/);
    if (kv === -1) {
      name = afterPrefix.trim();
    } else {
      name = afterPrefix.slice(0, kv).trim();
      tail = afterPrefix.slice(kv).trim();
    }
  }

  if (name === "") {
    throw new MarkerParseError("Marker name is empty");
  }
  if (!NAME_RE.test(name)) {
    throw new MarkerParseError(`Invalid marker name: ${JSON.stringify(name)}`);
  }

  const { inputs, outputs } = parseTail(tail);
  return { name, tag, inputs, outputs };
}

/** Parse one multi-line continuation comment. Returns null if the line isn't
 * a continuation marker. */
function parseContinuationLine(
  trimmed: string,
): { kind: "inputs" | "outputs" | "tag"; value: string } | null {
  const match = CONTINUATION_RE.exec(trimmed);
  if (match === null) {
    return null;
  }
  const key = match[1] ?? "";
  const value = (match[2] ?? "").trim();
  if (key === "inputs" || key === "in") {
    return { kind: "inputs", value };
  }
  if (key === "outputs" || key === "out") {
    return { kind: "outputs", value };
  }
  return { kind: "tag", value };
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
    const binding = raw.trim();
    if (binding === "") {
      throw new MarkerParseError("Empty input binding");
    }
    // Re-serialise so the stored string is normalised and structural errors
    // surface here at parse time.
    const parsed = parseInputBindingOrThrow(binding);
    return formatInputBinding(parsed);
  });
}

/**
 * Split a source reference into its alias (or null), node name, and port.
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

/**
 * Split an `in=` binding into its local Python variable and upstream source ref.
 * The notebook marker grammar requires the explicit `local<-source.ref` form.
 */
export function parseInputBinding(binding: string): ParsedInputBinding | null {
  try {
    return parseInputBindingOrThrow(binding);
  } catch {
    return null;
  }
}

/** Serialise a parsed input binding to canonical `local<-alias:Node.port` form. */
export function formatInputBinding(binding: ParsedInputBinding): string {
  return `${binding.localName}<-${formatRef(binding.source)}`;
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

function parseInputBindingOrThrow(binding: string): ParsedInputBinding {
  const arrowIdx = binding.indexOf("<-");
  if (arrowIdx === -1) {
    throw new MarkerParseError(
      `Input binding ${JSON.stringify(binding)} must be localName<-nodeName.portName`,
    );
  }
  const localName = binding.slice(0, arrowIdx).trim();
  const sourceRef = binding.slice(arrowIdx + 2).trim();
  if (!PORT_RE.test(localName)) {
    throw new MarkerParseError(`Invalid local input name: ${JSON.stringify(localName)}`);
  }
  if (sourceRef === "") {
    throw new MarkerParseError(`Input binding ${JSON.stringify(binding)} is missing a source ref`);
  }
  return { localName, source: parseRefOrThrow(sourceRef) };
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
