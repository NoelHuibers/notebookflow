/**
 * JupyterLab surface UI strings (EN + DE). JupyterLab sets the UI language on
 * <html lang> (via jupyterlab-language-pack-*), so we resolve that (falling
 * back to the browser language) through graph-canvas's canvasLocale once at
 * module load. Placeholders are simple `{x}` tokens filled via `.replace()`,
 * matching the graph-canvas labels convention.
 */
import { canvasLocale } from "@notebookflow/graph-canvas";

export const en = {
  couldNotLoadRegistry: "Could not load node registry: {message}",
  addNodeFailed: "add node failed: {message}",
  couldNotUpdateNode: "Could not update {name}: {message}",
  outputUpdateFailed: "output update failed: {message}",
  nodeCountPath: "{count} nodes · {path}",
  showSidebar: "Show sidebar",
  hideSidebar: "Hide sidebar",
  running: "Running…",
  runPipeline: "Run pipeline",
  resizeSidebarAria: "Resize canvas sidebar",
  selectedHeading: "Selected",
  clickNode: "Click a node.",
  paletteHeading: "Palette",
  loadingRegistry: "Loading node registry…",
  executionEvents: "Execution ({count})",
  clickRunToDispatch: "Click Run to dispatch this pipeline.",
  generatedVia: "Last generated via {backend}.",
  generatedViaAt: "Last generated via {backend} at {when}.",
};

export const de: typeof en = {
  couldNotLoadRegistry: "Knoten-Registry konnte nicht geladen werden: {message}",
  addNodeFailed: "Knoten konnte nicht hinzugefügt werden: {message}",
  couldNotUpdateNode: "{name} konnte nicht aktualisiert werden: {message}",
  outputUpdateFailed: "Ausgaben konnten nicht aktualisiert werden: {message}",
  nodeCountPath: "{count} Knoten · {path}",
  showSidebar: "Seitenleiste anzeigen",
  hideSidebar: "Seitenleiste ausblenden",
  running: "Wird ausgeführt…",
  runPipeline: "Pipeline ausführen",
  resizeSidebarAria: "Canvas-Seitenleiste anpassen",
  selectedHeading: "Ausgewählt",
  clickNode: "Klicke auf einen Knoten.",
  paletteHeading: "Palette",
  loadingRegistry: "Knoten-Registry wird geladen…",
  executionEvents: "Ausführung ({count})",
  clickRunToDispatch: "Klicke auf Ausführen, um diese Pipeline zu starten.",
  generatedVia: "Zuletzt generiert über {backend}.",
  generatedViaAt: "Zuletzt generiert über {backend} am {when}.",
};

/** The UI locale resolved at module load ("de" | "en"). */
export function resolveLocale(): "de" | "en" {
  return canvasLocale(document.documentElement.lang || navigator.language);
}

/** Pick the string table for the JupyterLab UI language. */
export function resolveStrings(): typeof en {
  return resolveLocale() === "de" ? de : en;
}
