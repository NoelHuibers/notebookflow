/**
 * NodeGroup — renders a notebook as a header card on the canvas.
 *
 * Phase-2 form: a labelled chip showing the notebook filename and a
 * collapse toggle. Nodes belonging to the group are rendered as standalone
 * React Flow nodes positioned beneath this header. A future iteration will
 * promote this to a true React Flow parent node (with children nested via
 * `parentNode`/`extent: 'parent'`) once layout/dragging behaviour is
 * worked out.
 */

import type { ReactElement } from "react";
import type { NodeProps } from "reactflow";

import type { NodeGroupModel } from "../types";

export interface NodeGroupData extends NodeGroupModel {
  onToggle?: (groupId: string) => void;
}

export function NodeGroup(props: NodeProps<NodeGroupData>): ReactElement {
  const { data, selected } = props;

  const handleToggle = (): void => {
    if (data.onToggle !== undefined) {
      data.onToggle(data.id);
    }
  };

  const wrapperClass = [
    "flex min-w-[220px] items-center gap-2 rounded-lg border-2 bg-muted px-2.5 py-1.5 font-sans text-xs text-foreground shadow-sm",
    selected ? "border-foreground" : "border-border",
  ].join(" ");

  return (
    <div className={wrapperClass}>
      <button
        type="button"
        onClick={handleToggle}
        aria-label={data.collapsed ? "Expand notebook" : "Collapse notebook"}
        className="cursor-pointer border-none bg-transparent p-0 text-sm leading-none text-foreground"
      >
        {data.collapsed ? "▶" : "▼"}
      </button>
      <span className="font-semibold">{data.name}</span>
      <span className="text-[11px] text-muted-foreground">{data.notebookPath}</span>
    </div>
  );
}
