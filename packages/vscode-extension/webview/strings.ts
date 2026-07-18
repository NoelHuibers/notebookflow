/**
 * Webview UI strings (EN + DE). The extension host injects the VS Code display
 * language as `window.__NBF_LOCALE__` (see WebviewPanel.renderHtml); we resolve
 * it once through graph-canvas's canvasLocale — the locale can't change within
 * a webview's lifetime. Placeholders are simple `{x}` tokens filled via
 * `.replace()`, matching the graph-canvas labels convention.
 */
import { canvasLocale } from "@notebookflow/graph-canvas";

export const en = {
  startEngineBeforePalette: "Start the engine before adding nodes from the palette.",
  addNodeFailed: "add node failed: {message}",
  startEngineToLoadPalette: "Start the engine to load the node palette.",
  couldNotLoadRegistry: "Could not load node registry: {message}",
  couldNotUpdateNode: "Could not update {name}: {message}",
  nodeCount: "{count} nodes",
  enginePrefix: "engine: ",
  engineNotRunning: "not running",
  showSidebar: "Show sidebar",
  hideSidebar: "Hide sidebar",
  running: "Running…",
  runPipeline: "Run pipeline",
  resizeSidebarAria: "Resize canvas sidebar",
  selectedHeading: "Selected",
  clickNodeToInspect: "Click a node to inspect.",
  paletteHeading: "Palette",
  loadingRegistry: "Loading node registry…",
  startEngineToAddNodes: "Start the engine to add nodes",
  appendOrDrag: "Click to append at the end, or drag onto the canvas to place between nodes",
  executionEvents: "Execution events ({count})",
  startEngineToRun: "Start the engine to run pipelines.",
  clickRunToDispatch: "Click Run to dispatch this pipeline.",
  generatedVia: "Last generated via {backend}.",
  generatedViaAt: "Last generated via {backend} at {when}.",
};

export const de: typeof en = {
  startEngineBeforePalette: "Starte die Engine, bevor du Knoten aus der Palette hinzufügst.",
  addNodeFailed: "Knoten konnte nicht hinzugefügt werden: {message}",
  startEngineToLoadPalette: "Starte die Engine, um die Knoten-Palette zu laden.",
  couldNotLoadRegistry: "Knoten-Registry konnte nicht geladen werden: {message}",
  couldNotUpdateNode: "{name} konnte nicht aktualisiert werden: {message}",
  nodeCount: "{count} Knoten",
  enginePrefix: "Engine: ",
  engineNotRunning: "läuft nicht",
  showSidebar: "Seitenleiste anzeigen",
  hideSidebar: "Seitenleiste ausblenden",
  running: "Wird ausgeführt…",
  runPipeline: "Pipeline ausführen",
  resizeSidebarAria: "Canvas-Seitenleiste anpassen",
  selectedHeading: "Ausgewählt",
  clickNodeToInspect: "Klicke auf einen Knoten.",
  paletteHeading: "Palette",
  loadingRegistry: "Knoten-Registry wird geladen…",
  startEngineToAddNodes: "Starte die Engine, um Knoten hinzuzufügen",
  appendOrDrag:
    "Zum Anhängen ans Ende klicken oder auf die Leinwand ziehen, um zwischen Knoten zu platzieren",
  executionEvents: "Ausführungs-Ereignisse ({count})",
  startEngineToRun: "Starte die Engine, um Pipelines auszuführen.",
  clickRunToDispatch: "Klicke auf Ausführen, um diese Pipeline zu starten.",
  generatedVia: "Zuletzt generiert über {backend}.",
  generatedViaAt: "Zuletzt generiert über {backend} am {when}.",
};

declare global {
  interface Window {
    __NBF_LOCALE__?: string;
  }
}

/** The locale the webview resolved at startup ("de" | "en"). */
export function resolveLocale(): "de" | "en" {
  return canvasLocale(window.__NBF_LOCALE__ ?? navigator.language);
}

/** Pick the string table for the injected VS Code display language. */
export function resolveStrings(): typeof en {
  return resolveLocale() === "de" ? de : en;
}
