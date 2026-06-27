/**
 * Panel layout persistence — which side panels are collapsed. Stored in
 * localStorage so reloads keep the user's layout.
 */

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
