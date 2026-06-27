import { type Context, createContext, useContext } from "react";

export interface InsertDropContextValue {
  paletteDragActive: boolean;
  setPaletteDragActive: (active: boolean) => void;
  hoveredSlotId: string | null;
  setHoveredSlotId: (id: string | null) => void;
  onInsertDrop: (manifestId: string, groupId: string, afterCellIndex: number) => void;
}

export const InsertDropContext: Context<InsertDropContextValue | null> =
  createContext<InsertDropContextValue | null>(null);

export function useInsertDropContext(): InsertDropContextValue | null {
  return useContext(InsertDropContext);
}
