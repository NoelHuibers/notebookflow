/**
 * German label sets for the shared canvas. Hosts that resolve their locale to
 * German pass these to <Canvas labels> / <NodeConfigEditor labels>; every other
 * locale falls back to the English defaults in labels.tsx.
 */
import type { CanvasLabels, NodeConfigLabels } from "./labels";

export const deCanvasLabels: CanvasLabels = {
  minimapShow: "Minimap anzeigen (M)",
  minimapHide: "Minimap ausblenden (M)",
  minimapToggle: "Minimap umschalten",
  minimapAria: "Canvas-Minimap",
  layoutToggle: "Layout umschalten",
  layoutSwitchTo: "Zu {target} wechseln",
  layoutHorizontal: "horizontal",
  layoutVertical: "vertikal",
  runSummaryAria: "Zusammenfassung des letzten Laufs",
  statusCompleted: "abgeschlossen",
  statusPartial: "teilweise",
  statusFailed: "fehlgeschlagen",
  statusNoNodes: "keine Knoten",
  canvasSummaryAria: "Canvas-Zusammenfassung",
  nodeCountOne: "{count} Knoten",
  nodeCountOther: "{count} Knoten",
  notebookCountOther: "{count} Notebooks",
  zoomHint: "⌘/Strg + Mausrad zum Zoomen",
  nodeNameAria: "Knotenname",
  renameHint: "Zum Umbenennen doppelklicken",
  renameNode: "Knoten umbenennen",
  nodeMetaTitle: "Eingabedatei · Ausgabezeilen",
  statusTitle: "Status: {status}",
  lastRunTitle: "Letzter Lauf: {duration}",
  unresolvedRefsTitle: "Nicht aufgelöste Eingaben:\n{refs}",
  unresolvedShort: "nicht aufgelöst: {refs}",
  statusIdle: "inaktiv",
  statusQueued: "wartet",
  statusRunning: "läuft",
  statusOk: "OK",
  statusError: "Fehler",
  statusSkipped: "übersprungen",
  tagInput: "Eingabe",
  tagTransform: "Transformation",
  tagOutput: "Ausgabe",
  tagAi: "KI",
  tagIo: "IO",
  portInput: "Eingang",
  portOutput: "Ausgang",
  addInput: "Eingang hinzufügen",
  addOutput: "Ausgang hinzufügen",
  portClickToEdit: "Zum Bearbeiten klicken",
  removePort: "{port} entfernen",
  portSourceAria: "Eingangsquelle",
  portVariableAria: "Ausgabevariable",
  expandNotebook: "Notebook ausklappen",
  collapseNotebook: "Notebook einklappen",
};

export const deNodeConfigLabels: NodeConfigLabels = {
  title: "Konfiguration",
  subtitle: "Wird getrennt von den Ein- und Ausgabe-Ports des Knotens verwaltet.",
  generateNode: "Knoten generieren",
  applyConfig: "Konfiguration anwenden",
  updating: "Wird aktualisiert…",
  upToDate: "Aktuell",
};

/**
 * Map a BCP-47 language tag (e.g. from `vscode.env.language` or
 * `navigator.language`) to the canvas locales we ship. Anything that isn't
 * German falls back to English.
 */
export function canvasLocale(lang: string | null | undefined): "de" | "en" {
  return lang && /^de/i.test(lang) ? "de" : "en";
}
