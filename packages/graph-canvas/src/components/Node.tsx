/**
 * NotebookNode — renders a single cell-group node on the canvas.
 *
 * Header shows the node name and a tag chip. Input handles on the left, one
 * per declared `in=` ref. Output handles on the right, one per declared
 * `out=` port name. Double-click the name to rename via the host-provided
 * callback (the Canvas passes it through `data`).
 *
 * Styling uses Tailwind utility classes. The consumer (e.g. the web-app)
 * is responsible for setting up Tailwind so these classes resolve; the
 * shadcn design tokens (`bg-card`, `text-card-foreground`, `border`, etc.)
 * are expected to be defined in the consumer's CSS.
 */

import type { CSSProperties, ReactElement } from "react";
import type { NodeProps } from "reactflow";
import { Handle, Position } from "reactflow";

import type { NodeModel, NodeTag } from "../types";

export interface NotebookNodeData extends NodeModel {
  onRename?: (nodeId: string, nextName: string) => void;
}

const TAG_HEADER_BG: Record<NodeTag, string> = {
  input: "bg-blue-500",
  transform: "bg-emerald-500",
  output: "bg-red-500",
  ai: "bg-purple-500",
  io: "bg-orange-500",
};

const TAG_RING: Record<NodeTag, string> = {
  input: "ring-blue-500/30",
  transform: "ring-emerald-500/30",
  output: "ring-red-500/30",
  ai: "ring-purple-500/30",
  io: "ring-orange-500/30",
};

const TAG_HANDLE_COLOR: Record<NodeTag, string> = {
  input: "#3b82f6",
  transform: "#10b981",
  output: "#ef4444",
  ai: "#a855f7",
  io: "#f97316",
};

export function NotebookNode(props: NodeProps<NotebookNodeData>): ReactElement {
  const { data, selected } = props;

  const handleRename = (): void => {
    if (data.onRename === undefined) {
      return;
    }
    const next = globalThis.prompt("New node name:", data.name);
    if (next !== null && next.trim() !== "" && next !== data.name) {
      data.onRename(data.id, next.trim());
    }
  };

  const wrapperClass = [
    "min-w-[200px] rounded-md border-2 bg-card text-card-foreground font-sans text-sm shadow-sm",
    selected ? `border-foreground ring-2 ${TAG_RING[data.tag]}` : "border-border",
  ].join(" ");

  const headerClass = [
    "flex items-center justify-between gap-2 rounded-t-[3px] px-2 py-1.5 text-white",
    TAG_HEADER_BG[data.tag],
  ].join(" ");

  return (
    <div className={wrapperClass}>
      <div className={headerClass}>
        <button
          type="button"
          onDoubleClick={handleRename}
          title="Double-click to rename"
          className="cursor-text select-none border-none bg-transparent p-0 text-left font-semibold text-inherit"
        >
          {data.name}
        </button>
        <span className="rounded-full bg-black/20 px-1.5 py-px text-[10px] uppercase tracking-wider">
          {data.tag}
        </span>
      </div>
      <div className="px-2 py-1.5 text-xs text-muted-foreground">
        {data.inputs.length === 0 && data.outputs.length === 0 ? (
          <span className="italic text-muted-foreground/70">no ports</span>
        ) : (
          <>
            {data.inputs.length > 0 && (
              <div>
                <strong>in:</strong> {data.inputs.join(", ")}
              </div>
            )}
            {data.outputs.length > 0 && (
              <div>
                <strong>out:</strong> {data.outputs.join(", ")}
              </div>
            )}
          </>
        )}
      </div>
      {data.inputs.map((ref, idx) => (
        <Handle
          key={`in-${ref}`}
          id={ref}
          type="target"
          position={Position.Left}
          style={handleStyle(idx, data.inputs.length, data.tag)}
        />
      ))}
      {data.outputs.map((port, idx) => (
        <Handle
          key={`out-${port}`}
          id={port}
          type="source"
          position={Position.Right}
          style={handleStyle(idx, data.outputs.length, data.tag)}
        />
      ))}
    </div>
  );
}

function handleStyle(index: number, total: number, tag: NodeTag): CSSProperties {
  return { top: portOffset(index, total), background: TAG_HANDLE_COLOR[tag] };
}

function portOffset(index: number, total: number): string {
  if (total <= 1) {
    return "50%";
  }
  const pct = 30 + (index / (total - 1)) * 40;
  return `${String(pct)}%`;
}
