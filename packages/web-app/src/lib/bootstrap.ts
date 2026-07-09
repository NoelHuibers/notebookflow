/**
 * Initial workspace bootstrap — load the preprocessing notebook from the
 * bundled analyst pipeline. The other pipeline notebooks live beside it in
 * /examples and can be opened when the user wants the full cross-file graph.
 */

import type { LoadedNotebook } from "@/types/workspace";

import preprocessing from "../../../../examples/preprocessing.ipynb?raw";
import { parseNotebook } from "./notebook";

const NOTEBOOK_FIXTURES: Array<{ name: string; text: string }> = [
  { name: "preprocessing.ipynb", text: preprocessing },
];

export function bootstrapNotebookFixtures(): LoadedNotebook[] {
  return NOTEBOOK_FIXTURES.map(({ name, text }) => {
    const parsed = parseNotebook(text);
    return { name, cells: parsed.cells, doc: parsed.doc };
  });
}
