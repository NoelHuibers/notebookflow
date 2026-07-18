/**
 * Panel layout persistence — which side panels are collapsed. Stored in
 * localStorage so reloads keep the user's layout. Also home to the layout
 * constants and pure clamp helpers shared with usePanelLayout.
 */

import { clamp } from "@/lib/utils";

export const DIVIDER_SIZE_PX = 10;

export const MIN_NOTEBOOK_WIDTH_PX = 280;
export const MIN_CANVAS_BODY_WIDTH_PX = 320;
export const MIN_SIDEBAR_WIDTH_PX = 240;
export const DEFAULT_SIDEBAR_WIDTH_PX = 288;
export const MIN_MAIN_HEIGHT_PX = 220;
export const MIN_INSPECTOR_HEIGHT_PX = 140;
export const DEFAULT_NOTEBOOK_RATIO = 50;
export const DEFAULT_MAIN_RATIO = 72;
export const KEYBOARD_RESIZE_STEP = 2;

export function clampOptionalRatio(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : clamp(value, 0, 100);
}

export function clampSidebarWidthValue(value: number, host: HTMLElement | null): number {
  if (host === null) {
    return Math.max(MIN_SIDEBAR_WIDTH_PX, value);
  }
  const maxWidth = Math.max(
    host.clientWidth - MIN_CANVAS_BODY_WIDTH_PX - DIVIDER_SIZE_PX,
    MIN_SIDEBAR_WIDTH_PX,
  );
  return clamp(value, MIN_SIDEBAR_WIDTH_PX, maxWidth);
}

export const PANEL_STORAGE_KEY = "notebookflow.panels.v2";
const LEGACY_PANEL_STORAGE_KEY = "notebookflow.panels.v1";

export interface PanelLayoutState {
  // Files list and code cells collapse independently — close files without
  // closing code, and vice-versa. No separate activity rail.
  filesCollapsed: boolean;
  cellsCollapsed: boolean;
  inspectorCollapsed: boolean;
  sidebarCollapsed: boolean;
}

export const DEFAULT_PANEL_LAYOUT: PanelLayoutState = {
  filesCollapsed: false,
  cellsCollapsed: false,
  inspectorCollapsed: true,
  sidebarCollapsed: false,
};

function mergePanelLayout(parsed: Partial<PanelLayoutState>): PanelLayoutState {
  return {
    filesCollapsed: parsed.filesCollapsed === true,
    cellsCollapsed: parsed.cellsCollapsed === true,
    inspectorCollapsed: parsed.inspectorCollapsed ?? DEFAULT_PANEL_LAYOUT.inspectorCollapsed,
    sidebarCollapsed: parsed.sidebarCollapsed === true,
  };
}

export function readPanelLayout(): PanelLayoutState {
  if (typeof window === "undefined") {
    return DEFAULT_PANEL_LAYOUT;
  }
  try {
    const raw =
      window.localStorage.getItem(PANEL_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_PANEL_STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_PANEL_LAYOUT;
    }
    const parsed = JSON.parse(raw) as Partial<PanelLayoutState>;
    const fromLegacy = window.localStorage.getItem(PANEL_STORAGE_KEY) === null;
    const layout = mergePanelLayout(parsed);
    if (fromLegacy) {
      // v1 often persisted inspectorExpanded after node selection; default hidden in v2.
      return { ...layout, inspectorCollapsed: true };
    }
    return layout;
  } catch {
    return DEFAULT_PANEL_LAYOUT;
  }
}
