/**
 * JupyterLab surface UI strings (EN + DE). JupyterLab sets the UI language on
 * <html lang> (via jupyterlab-language-pack-*), so we resolve that (falling
 * back to the browser language) through graph-canvas's canvasLocale once at
 * module load. Placeholders are simple `{x}` tokens filled via `.replace()`,
 * matching the graph-canvas labels convention.
 */
import type {
  AskPaletteLabels,
  CellOutputsLabels,
  ComposeDialogLabels,
  ExplanationPanelLabels,
} from "@notebookflow/app-core";
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
  paletteSearchPlaceholder: "Search nodes…",
  paletteSearchLabel: "Search nodes",
  paletteAll: "all",
  paletteNoMatches: "No nodes match the current search or filter.",
  appendOrDrag: "Click to append at the end, or drag onto the canvas to place between nodes",
  loadingRegistry: "Loading node registry…",
  executionEvents: "Execution ({count})",
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
  applyProposalFailed: "Could not apply the draft: {message}",
  outputsHeading: "Outputs",
  dataHeading: "Data",
  upload: "Upload",
  uploadData: "Upload data file (CSV, etc.)",
  dataEmpty: "Upload a CSV, then read it by name in a node.",
  dataUnavailable: "Data files unavailable: {message}",
  deleteDataFile: "Delete {name}",
  uploadDataFailed: "Upload failed: {message}",
  deleteDataFailed: "Delete failed: {message}",
  cloud: "Cloud",
  cloudTitle: "NotebookFlow Cloud account (optional): sign in, open or save cloud notebooks",
  cloudMenuTitle: "NotebookFlow Cloud",
  cloudMenuLabel: "Action",
  cloudMenuSignIn: "Sign in…",
  cloudMenuOpen: "Open cloud notebook…",
  cloudMenuSave: "Save notebook to cloud",
  cloudMenuSignOut: "Sign out",
  cloudSignInTitle: "Sign in to NotebookFlow Cloud",
  cloudSignInBody:
    "Your sign-in code is {code}. Approve the sign-in in the browser window — JupyterLab keeps polling until you do.",
  cloudOpenBrowser: "Open Browser",
  cloudWaiting: "NotebookFlow: waiting for browser approval…",
  cloudSignedIn: "Signed in to NotebookFlow Cloud.",
  cloudSignedOut: "Signed out of NotebookFlow Cloud.",
  cloudSignInFailed: "Cloud sign-in failed: {message}",
  cloudSignInExpired: "The sign-in code expired before it was approved. Try again.",
  cloudSignInDenied: "The sign-in was denied in the browser.",
  cloudSignInRequired:
    "Sign in to NotebookFlow Cloud first (command: NotebookFlow: Sign in to NotebookFlow Cloud).",
  cloudSessionExpired: "Your cloud session expired — sign in again.",
  cloudRequestFailed: "Cloud request failed: {message}",
  cloudNoNotebooks: "No cloud notebooks saved yet.",
  cloudPickNotebook: "Cloud notebook",
  cloudOpened: "Opened cloud notebook {name}.",
  cloudSaved: "Saved to NotebookFlow Cloud as {name}.",
  cloudNoNotebookOpen: "Open a notebook before saving it to the cloud.",
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
  paletteSearchPlaceholder: "Knoten suchen…",
  paletteSearchLabel: "Knoten suchen",
  paletteAll: "alle",
  paletteNoMatches: "Keine Knoten entsprechen der aktuellen Suche oder dem Filter.",
  appendOrDrag:
    "Zum Anhängen ans Ende klicken oder auf die Leinwand ziehen, um zwischen Knoten zu platzieren",
  loadingRegistry: "Knoten-Registry wird geladen…",
  executionEvents: "Ausführung ({count})",
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
  applyProposalFailed: "Entwurf konnte nicht angewendet werden: {message}",
  outputsHeading: "Ausgaben",
  dataHeading: "Daten",
  upload: "Hochladen",
  uploadData: "Datendatei hochladen (CSV usw.)",
  dataEmpty: "Lade eine CSV hoch und lies sie dann in einem Knoten per Name.",
  dataUnavailable: "Datendateien nicht verfügbar: {message}",
  deleteDataFile: "{name} löschen",
  uploadDataFailed: "Hochladen fehlgeschlagen: {message}",
  deleteDataFailed: "Löschen fehlgeschlagen: {message}",
  cloud: "Cloud",
  cloudTitle:
    "NotebookFlow-Cloud-Konto (optional): anmelden, Cloud-Notebooks öffnen oder speichern",
  cloudMenuTitle: "NotebookFlow Cloud",
  cloudMenuLabel: "Aktion",
  cloudMenuSignIn: "Anmelden…",
  cloudMenuOpen: "Cloud-Notebook öffnen…",
  cloudMenuSave: "Notebook in der Cloud speichern",
  cloudMenuSignOut: "Abmelden",
  cloudSignInTitle: "Bei NotebookFlow Cloud anmelden",
  cloudSignInBody:
    "Dein Anmeldecode ist {code}. Bestätige die Anmeldung im Browserfenster — JupyterLab fragt so lange nach, bis du es tust.",
  cloudOpenBrowser: "Browser öffnen",
  cloudWaiting: "NotebookFlow: Warten auf die Bestätigung im Browser…",
  cloudSignedIn: "Bei NotebookFlow Cloud angemeldet.",
  cloudSignedOut: "Von NotebookFlow Cloud abgemeldet.",
  cloudSignInFailed: "Cloud-Anmeldung fehlgeschlagen: {message}",
  cloudSignInExpired:
    "Der Anmeldecode ist abgelaufen, bevor er bestätigt wurde. Versuche es erneut.",
  cloudSignInDenied: "Die Anmeldung wurde im Browser abgelehnt.",
  cloudSignInRequired:
    "Melde dich zuerst bei NotebookFlow Cloud an (Befehl: NotebookFlow: Sign in to NotebookFlow Cloud).",
  cloudSessionExpired: "Deine Cloud-Sitzung ist abgelaufen — melde dich erneut an.",
  cloudRequestFailed: "Cloud-Anfrage fehlgeschlagen: {message}",
  cloudNoNotebooks: "Noch keine Cloud-Notebooks gespeichert.",
  cloudPickNotebook: "Cloud-Notebook",
  cloudOpened: "Cloud-Notebook {name} geöffnet.",
  cloudSaved: "In NotebookFlow Cloud als {name} gespeichert.",
  cloudNoNotebookOpen: "Öffne ein Notebook, bevor du es in der Cloud speicherst.",
};

// DE label tables for the shared app-core AI dialogs. Key sets mirror the
// components' default*Labels; English hosts pass `undefined` so the
// components fall back to their built-in English defaults. Translations
// match the VS Code webview / web-app catalogs.
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

export const deCellOutputsLabels: CellOutputsLabels = {
  streaming: "Wird gestreamt",
  streamingTitle: "Knoten wird ausgeführt – Ausgabe wird gestreamt",
  outputFigureAlt: "Ausgabe-Abbildung der Zelle",
};

/** The UI locale resolved at module load ("de" | "en"). */
export function resolveLocale(): "de" | "en" {
  return canvasLocale(document.documentElement.lang || navigator.language);
}

/** Pick the string table for the JupyterLab UI language. */
export function resolveStrings(): typeof en {
  return resolveLocale() === "de" ? de : en;
}
