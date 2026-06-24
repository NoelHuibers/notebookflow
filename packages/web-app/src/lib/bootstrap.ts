/**
 * Initial workspace bootstrap — load the bundled two-node fixture as the
 * starting notebook and its baseline sources.
 */

import type { LoadedNotebook } from "@/types/workspace";

import twoNode from "../fixtures/two-node.ipynb.json";
import { parseNotebook } from "./notebook";

export function bootstrapFromFixture(): LoadedNotebook {
  const parsed = parseNotebook(JSON.stringify(twoNode));
  return { name: "two-node.ipynb", cells: parsed.cells, doc: parsed.doc };
}

export function bootstrapBaselineSources(): string[] {
  return parseNotebook(JSON.stringify(twoNode)).cells.map((cell) => cell.source);
}
