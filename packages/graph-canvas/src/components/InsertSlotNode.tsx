/**
 * Gap drop target between consecutive pipeline nodes — accepts palette drags
 * and inserts a new cell after the leading node in the notebook.
 */

import { Plus } from "lucide-react";
import type { DragEvent, ReactElement } from "react";
import { useCallback } from "react";
import type { NodeProps } from "reactflow";
import { useInsertDropContext } from "./insertDropContext";
import { isPaletteDrag, readPaletteDragManifestId } from "./paletteDragData";

export interface InsertSlotData {
  groupId: string;
  afterCellIndex: number;
  orientation: "horizontal" | "vertical";
}

const SLOT_BORDER = "var(--notebookflow-node-border, #d1d5db)";
const SLOT_ACCENT = "var(--notebookflow-primary, #2563eb)";

export function InsertSlotNode(props: NodeProps<InsertSlotData>): ReactElement {
  const { id, data } = props;
  const ctx = useInsertDropContext();
  const active = ctx?.paletteDragActive ?? false;
  const hovered = ctx?.hoveredSlotId === id;

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      if (!isPaletteDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      ctx?.setHoveredSlotId(id);
    },
    [ctx, id],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      if (!isPaletteDrag(event.dataTransfer)) {
        return;
      }
      const manifestId = readPaletteDragManifestId(event.dataTransfer);
      if (manifestId === "") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      ctx?.setHoveredSlotId(null);
      ctx?.setPaletteDragActive(false);
      ctx?.onInsertDrop(manifestId, data.groupId, data.afterCellIndex);
    },
    [ctx, data.afterCellIndex, data.groupId],
  );

  const handleDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      const related = event.relatedTarget;
      if (related instanceof globalThis.Node && event.currentTarget.contains(related)) {
        return;
      }
      if (ctx?.hoveredSlotId === id) {
        ctx.setHoveredSlotId(null);
      }
    },
    [ctx, id],
  );

  const isHorizontal = data.orientation === "horizontal";

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: palette drag target between nodes; click-to-add remains on the palette
    <div
      className="nodrag nopan"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        pointerEvents: active ? "auto" : "none",
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={handleDragLeave}
    >
      {active ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: isHorizontal ? "100%" : "calc(100% - 8px)",
            height: isHorizontal ? "calc(100% - 8px)" : "100%",
            borderRadius: 6,
            border: `${hovered ? 2 : 1}px dashed ${hovered ? SLOT_ACCENT : SLOT_BORDER}`,
            background: hovered
              ? "color-mix(in srgb, var(--notebookflow-primary, #2563eb) 12%, transparent)"
              : "transparent",
            color: hovered ? SLOT_ACCENT : "var(--notebookflow-node-muted, #6b7280)",
            transition: "border-color 120ms ease, background 120ms ease, color 120ms ease",
          }}
        >
          <Plus size={hovered ? 16 : 14} strokeWidth={hovered ? 2.5 : 2} aria-hidden />
        </div>
      ) : null}
    </div>
  );
}

export function insertSlotId(groupId: string, afterCellIndex: number): string {
  return `insert:${groupId}::${String(afterCellIndex)}`;
}
