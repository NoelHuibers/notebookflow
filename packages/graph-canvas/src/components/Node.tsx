/**
 * NotebookNode — renders a single cell-group node on the canvas.
 *
 * Shows the node name, tag-coloured header, input/output ports. Clicking the
 * body selects the node (which the cell view then scrolls to).
 */

import type { ReactElement } from "react";
import type { NodeModel } from "../types";

export interface NotebookNodeProps {
  data: NodeModel;
  selected: boolean;
}

export function NotebookNode(_props: NotebookNodeProps): ReactElement {
  // TODO: render header (name + tag chip), port handles for inputs/outputs.
  throw new Error("NotebookNode: not implemented");
}
