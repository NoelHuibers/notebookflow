/**
 * Panel layout persistence — which side panels are collapsed. Stored in
 * localStorage so reloads keep the user's layout.
 */

export const PANEL_STORAGE_KEY = "notebookflow.panels.v1";

export interface PanelLayoutState {
  // The left workspace (files list + code cells) toggled as one, from the
  // activity rail. Open by default.
  workspaceOpen: boolean;
  inspectorCollapsed: boolean;
}

export const DEFAULT_PANEL_LAYOUT: PanelLayoutState = {
  workspaceOpen: true,
  inspectorCollapsed: true,
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
      // Workspace defaults to open; only an explicit false collapses it.
      workspaceOpen: parsed.workspaceOpen !== false,
      // Inspector defaults to collapsed; only an explicit false expands it.
      inspectorCollapsed: parsed.inspectorCollapsed !== false,
    };
  } catch {
    return DEFAULT_PANEL_LAYOUT;
  }
}
