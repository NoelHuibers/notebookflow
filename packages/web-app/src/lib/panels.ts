/**
 * Panel layout persistence — which side panels are collapsed. Stored in
 * localStorage so reloads keep the user's layout.
 */

export const PANEL_STORAGE_KEY = "notebookflow.panels.v1";

export interface PanelLayoutState {
  cellsCollapsed: boolean;
  inspectorCollapsed: boolean;
  filesCollapsed: boolean;
}

export const DEFAULT_PANEL_LAYOUT: PanelLayoutState = {
  cellsCollapsed: false,
  inspectorCollapsed: true,
  filesCollapsed: false,
};

export function readPanelLayout(): PanelLayoutState {
  if (typeof window === "undefined") {
    return DEFAULT_PANEL_LAYOUT;
  }
  try {
    const raw = window.localStorage.getItem(PANEL_STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_PANEL_LAYOUT;
    }
    const parsed = JSON.parse(raw) as Partial<PanelLayoutState>;
    return {
      cellsCollapsed: parsed.cellsCollapsed === true,
      // Inspector defaults to collapsed; only an explicit false expands it.
      inspectorCollapsed: parsed.inspectorCollapsed !== false,
      filesCollapsed: parsed.filesCollapsed === true,
    };
  } catch {
    return DEFAULT_PANEL_LAYOUT;
  }
}
