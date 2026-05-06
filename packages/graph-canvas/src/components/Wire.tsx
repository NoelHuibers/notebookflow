/**
 * Wire — custom React Flow edge for a node-to-node connection.
 *
 * Distinguishes intra-notebook wires (thin) from cross-notebook wires (thick,
 * dashed) so users can quickly read the pipeline structure at a glance.
 */

import type { ReactElement } from "react";
import type { WireModel } from "../types";

export interface WireProps {
  id: string;
  data: WireModel;
  selected: boolean;
}

export function Wire(_props: WireProps): ReactElement {
  // TODO: render bezier path. Style based on whether source/target groups differ.
  throw new Error("Wire: not implemented");
}
