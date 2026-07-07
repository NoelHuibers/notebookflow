// `files` namespace — the left-hand workspace explorer (open notebooks + data
// files) and the drag-and-drop notebook drop zone. `en` is the source of truth
// for the shape; `de` is typed against it so both catalogs stay in sync.

export const en = {
  // FilesRail
  showFiles: "Show files",
  files: "Files",
  openNotebook: "Open notebook",
  createNotebook: "New notebook",
  importNotebook: "Import notebook",
  hideFiles: "Hide files",
  unsavedChanges: "Unsaved changes",
  closeFile: "Close {{name}}",
  data: "Data",
  uploadData: "Upload data file (CSV, etc.)",
  uploadDataAria: "Upload data file",
  dataEmptyPrefix: "Upload a CSV, then read it by name in a node:",
  addNodeFor: "Add a node that loads {{name}}",
  addLoadCsvTitle: "Add a Load CSV node for this file",
  deleteFile: "Delete {{name}}",

  // FileDropZone
  createNotebookButton: "New notebook",
  openNotebookButton: "Import notebook",
  dropTitle: "Drop your .ipynb",
  dropSubtitle: "Parses cells and renders the canvas",
};

export const de: typeof en = {
  // FilesRail
  showFiles: "Dateien anzeigen",
  files: "Dateien",
  openNotebook: "Notebook öffnen",
  createNotebook: "Neues Notebook",
  importNotebook: "Notebook importieren",
  hideFiles: "Dateien ausblenden",
  unsavedChanges: "Nicht gespeicherte Änderungen",
  closeFile: "{{name}} schließen",
  data: "Daten",
  uploadData: "Datendatei hochladen (CSV usw.)",
  uploadDataAria: "Datendatei hochladen",
  dataEmptyPrefix: "Lade eine CSV hoch und lies sie dann in einem Knoten per Name:",
  addNodeFor: "Einen Knoten hinzufügen, der {{name}} lädt",
  addLoadCsvTitle: "Einen Load-CSV-Knoten für diese Datei hinzufügen",
  deleteFile: "{{name}} löschen",

  // FileDropZone
  createNotebookButton: "Neues Notebook",
  openNotebookButton: "Notebook importieren",
  dropTitle: "Lege deine .ipynb-Datei ab",
  dropSubtitle: "Liest Zellen ein und rendert die Canvas",
};
