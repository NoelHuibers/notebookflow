/**
 * Initial workspace bootstrap — load the bundled sales-demo fixture as the
 * starting notebook and its baseline sources. The demo is a self-contained
 * four-node pipeline (generate → clean → aggregate → plot) that renders a
 * table and a bar chart when run, with no external data file needed.
 */

import type { LoadedNotebook } from "@/types/workspace";

import salesDemo from "../fixtures/sales-demo.ipynb.json";
import { parseNotebook } from "./notebook";

export function bootstrapFromFixture(): LoadedNotebook {
  const parsed = parseNotebook(JSON.stringify(salesDemo));
  return { name: "sales-demo.ipynb", cells: parsed.cells, doc: parsed.doc };
}

export function bootstrapBaselineSources(): string[] {
  return parseNotebook(JSON.stringify(salesDemo)).cells.map((cell) => cell.source);
}
