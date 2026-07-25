/**
 * Initial workspace bootstrap — open two connected notebooks from the bundled
 * analyst pipeline so the first-run canvas shows a real cross-notebook graph:
 * `preprocessing.ipynb` publishes the train/test split, and
 * `model_baseline.ipynb` binds it via the `preprocessing:` alias
 * (`train_df<-preprocessing:Train test split.train_df`). The alias is the
 * filename stem, so the fixture names must stay `preprocessing.ipynb` /
 * `model_baseline.ipynb` for the wire to resolve. The other pipeline notebooks
 * live beside them in /examples and can be opened for the full graph.
 */

import type { LoadedNotebook } from "@/types/workspace";

import modelBaseline from "../../../../examples/model_baseline.ipynb?raw";
import preprocessing from "../../../../examples/preprocessing.ipynb?raw";
import { parseNotebook } from "./notebook";

const NOTEBOOK_FIXTURES: Array<{ name: string; text: string }> = [
  { name: "preprocessing.ipynb", text: preprocessing },
  { name: "model_baseline.ipynb", text: modelBaseline },
];

export function bootstrapNotebookFixtures(): LoadedNotebook[] {
  return NOTEBOOK_FIXTURES.map(({ name, text }) => {
    const parsed = parseNotebook(text);
    return { name, cells: parsed.cells, doc: parsed.doc };
  });
}
