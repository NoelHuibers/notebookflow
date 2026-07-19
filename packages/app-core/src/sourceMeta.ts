/**
 * Heuristics that derive canvas meta hints from raw cell sources. Shared by
 * every surface so the per-node "filename" half of the meta line matches the
 * web app's behaviour exactly.
 */

// Matches the first string literal passed to a common pandas reader (or a
// bare open()). Used to derive the canvas per-node meta line's filename half.
const READER_LITERAL_RE: RegExp =
  /(?:read_csv|read_excel|read_parquet|read_json|read_feather|open)\s*\(\s*(["'])([^"']+)\1/;

/**
 * Pull the input filename out of a cell's source, e.g. the `orders.csv` in
 * `pd.read_csv("data/orders.csv")`. Returns just the basename, or null when
 * no reader call is present. Purely heuristic -- good enough for a hint.
 */
export function extractSourceFilename(source: string): string | null {
  const match = READER_LITERAL_RE.exec(source);
  if (match === null) {
    return null;
  }
  const literal = match[2] ?? "";
  const basename = literal.split(/[\\/]/).pop() ?? literal;
  return basename === "" ? null : basename;
}
