/**
 * NodeGroup — renders a notebook as a collapsible container.
 *
 * Collapsed: a single rectangle exposing aggregate inputs/outputs.
 * Expanded: shows the contained NotebookNode children laid out internally.
 */

import type { ReactElement } from "react";
import type { NodeGroupModel } from "../types";

export interface NodeGroupProps {
  data: NodeGroupModel;
  onToggle?: (groupId: string) => void;
}

export function NodeGroup(_props: NodeGroupProps): ReactElement {
  // TODO: render container with header + collapse toggle. When expanded,
  //   children are rendered as React Flow sub-nodes positioned inside.
  throw new Error("NodeGroup: not implemented");
}
