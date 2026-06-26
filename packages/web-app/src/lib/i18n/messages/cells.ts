// `cells` namespace — the cell-editing surface: toolbar, cell list, editor
// chrome, outputs, and the cell-pane footer. `en` is the source of truth for the
// shape; `de` is typed against it so the compiler keeps both catalogs in sync.

export const en = {
  // CellToolbar
  addTitle: "Add a new cell at the end",
  add: "Add",
  cut: "Cut",
  cutTitle: "Cut the focused cell",
  copy: "Copy",
  copyTitle: "Copy the focused cell",
  paste: "Paste",
  pasteBelowTitle: "Paste below the focused cell",
  pasteEndTitle: "Paste at the end",
  pasteEmptyTitle: "Nothing in the clipboard",
  delete: "Delete",
  deleteTitle: "Delete the focused cell",
  cellType: "Cell type",
  changeTypeTitle: "Change the cell type",
  focusToChangeTypeTitle: "Focus a cell to change its type",
  collapsePane: "Collapse cell pane",
  // Cell-type labels (visible only; the data values code/markdown/raw stay)
  typeCode: "Code",
  typeMarkdown: "Markdown",
  typeRaw: "Raw",

  // CellEditor
  cellLabel: "cell {{index}}",

  // CellList
  empty: "No cells yet — drop a notebook.",

  // CellOutputs
  streaming: "Streaming",
  streamingTitle: "Node is executing — output streaming",
  outputFigureAlt: "Cell output figure",

  // CellPaneFooter
  cellCount_one: "{{count}} cell",
  cellCount_other: "{{count}} cells",
  countCode: "{{count}} code",
  countMd: "{{count}} md",
  countRaw: "{{count}} raw",
  modified: "Modified",
  inSync: "In sync",
  modifiedShort: "modified",
  inSyncShort: "in sync",
  autoIngest: "auto-ingest 300ms",
  autoIngestTitle: "Edits re-ingest after a 300ms idle window",
};

export const de: typeof en = {
  // CellToolbar
  addTitle: "Eine neue Zelle am Ende hinzufügen",
  add: "Hinzufügen",
  cut: "Ausschneiden",
  cutTitle: "Die fokussierte Zelle ausschneiden",
  copy: "Kopieren",
  copyTitle: "Die fokussierte Zelle kopieren",
  paste: "Einfügen",
  pasteBelowTitle: "Unter der fokussierten Zelle einfügen",
  pasteEndTitle: "Am Ende einfügen",
  pasteEmptyTitle: "Nichts in der Zwischenablage",
  delete: "Löschen",
  deleteTitle: "Die fokussierte Zelle löschen",
  cellType: "Zellentyp",
  changeTypeTitle: "Den Zellentyp ändern",
  focusToChangeTypeTitle: "Fokussiere eine Zelle, um ihren Typ zu ändern",
  collapsePane: "Zellenbereich einklappen",
  // Cell-type labels
  typeCode: "Code",
  typeMarkdown: "Markdown",
  typeRaw: "Roh",

  // CellEditor
  cellLabel: "Zelle {{index}}",

  // CellList
  empty: "Noch keine Zellen – lege ein Notebook ab.",

  // CellOutputs
  streaming: "Wird gestreamt",
  streamingTitle: "Knoten wird ausgeführt – Ausgabe wird gestreamt",
  outputFigureAlt: "Ausgabe-Abbildung der Zelle",

  // CellPaneFooter
  cellCount_one: "{{count}} Zelle",
  cellCount_other: "{{count}} Zellen",
  countCode: "{{count}} Code",
  countMd: "{{count}} md",
  countRaw: "{{count}} Roh",
  modified: "Geändert",
  inSync: "Synchron",
  modifiedShort: "geändert",
  inSyncShort: "synchron",
  autoIngest: "Auto-Ingest 300ms",
  autoIngestTitle: "Änderungen werden nach 300ms Ruhe erneut eingelesen",
};
