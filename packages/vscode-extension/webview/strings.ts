/**
 * Webview UI strings (EN + DE). The extension host injects the VS Code display
 * language as `window.__NBF_LOCALE__` (see WebviewPanel.renderHtml); we resolve
 * it once through graph-canvas's canvasLocale — the locale can't change within
 * a webview's lifetime. Placeholders are simple `{x}` tokens filled via
 * `.replace()`, matching the graph-canvas labels convention.
 */
import type {
  AskPaletteLabels,
  ComposeDialogLabels,
  ExplanationPanelLabels,
} from "@notebookflow/app-core";
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
  explain: "Explain",
  explaining: "Explaining…",
  explainTitle: "Ask the AI (or the template fallback) to describe what this pipeline does",
  compose: "Compose",
  composeTitle:
    "Describe a pipeline in plain English; the AI (or the template fallback) drafts the cells",
  askAi: "Ask AI",
  askAiTitle: "Ask AI anything about your pipeline (Cmd/Ctrl+K)",
  explainFailed: "Could not explain pipeline: {message}",
  composeEmpty: "Type a sentence describing the pipeline you want.",
  composeFailed: "Could not compose pipeline: {message}",
  askEmpty: "Ask a question or describe what you'd like to do.",
  askFailed: "Could not reach the engine: {message}",
  startEngineToUseAi: "Start the engine to use the AI features.",
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
  explain: "Erklären",
  explaining: "Wird erklärt…",
  explainTitle: "Lass die KI (oder die Vorlagen-Alternative) beschreiben, was diese Pipeline macht",
  compose: "Verfassen",
  composeTitle:
    "Beschreibe eine Pipeline in einfachem Deutsch; die KI (oder die Vorlagen-Alternative) entwirft die Zellen",
  askAi: "KI fragen",
  askAiTitle: "Frag die KI alles über deine Pipeline (Cmd/Ctrl+K)",
  explainFailed: "Pipeline konnte nicht erklärt werden: {message}",
  composeEmpty: "Schreibe einen Satz, der die gewünschte Pipeline beschreibt.",
  composeFailed: "Pipeline konnte nicht verfasst werden: {message}",
  askEmpty: "Stell eine Frage oder beschreibe, was du tun möchtest.",
  askFailed: "Engine konnte nicht erreicht werden: {message}",
  startEngineToUseAi: "Starte die Engine, um die KI-Funktionen zu nutzen.",
};

// DE label tables for the shared app-core AI dialogs. Key sets mirror the
// components' default*Labels; English hosts pass `undefined` so the
// components fall back to their built-in English defaults. Translations
// match the web-app's `ask` / `compose` / `explanation` catalogs.
export const deAskPaletteLabels: AskPaletteLabels = {
  title: "KI fragen",
  dismiss: "Schließen",
  promptPlaceholder:
    "Frag alles — beschreibe, was du tun möchtest, fordere eine Erklärung an oder stelle eine pandas-Frage",
  promptLabel: "Eingabe für KI fragen",
  thinking: "Denkt nach…",
  ask: "Fragen",
  shortcutHint: "⌘/Strg+Enter zum Senden · Esc zum Schließen",
};

export const deComposeDialogLabels: ComposeDialogLabels = {
  title: "Pipeline erstellen",
  dismiss: "Schließen",
  promptPlaceholder:
    "z. B. customers.csv laden, nach EU-Zeilen filtern, Umsatz nach Region plotten",
  promptLabel: "Pipeline-Beschreibung",
  drafting: "Entwurf wird erstellt…",
  draft: "Entwurf erstellen",
  replaceWithDraft: "Notebook durch Entwurf ersetzen",
};

export const deExplanationPanelLabels: ExplanationPanelLabels = {
  title: "Pipeline-Erklärung",
  dismiss: "Erklärung schließen",
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
