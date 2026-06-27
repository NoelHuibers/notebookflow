// Keyboard shortcuts dialog catalog (namespace: `shortcuts`). `en` is the source of
// truth for the shape; `de` is typed as `typeof en` so the compiler enforces parity.
// Key glyphs (⌘, Ctrl, Alt, Esc, M, ?) are not translated — only the descriptions.

export const en = {
  title: "Keyboard shortcuts",
  dismiss: "Dismiss",
  askAi: "Ask AI",
  toggleNodePalette: "Toggle sidebar (selected + palette)",
  toggleMinimap: "Toggle minimap",
  thisShortcutsList: "This shortcuts list",
  closePaletteDialog: "Close sidebar / dialog",
  selectNode: "Select node",
  renameNode: "Rename node",
  panCanvas: "Pan the canvas",
  zoomCanvas: "Zoom the canvas",
  sendInAskCompose: "Send (in Ask / Compose)",
};

export const de: typeof en = {
  title: "Tastenkürzel",
  dismiss: "Schließen",
  askAi: "KI fragen",
  toggleNodePalette: "Seitenleiste ein-/ausblenden (Auswahl + Palette)",
  toggleMinimap: "Minimap ein-/ausblenden",
  thisShortcutsList: "Diese Kürzelliste",
  closePaletteDialog: "Seitenleiste / Dialog schließen",
  selectNode: "Node auswählen",
  renameNode: "Node umbenennen",
  panCanvas: "Leinwand verschieben",
  zoomCanvas: "Leinwand zoomen",
  sendInAskCompose: "Senden (in Ask / Compose)",
};
