// First-run onboarding catalog (namespace: `onboarding`) — the welcome moment,
// the five-step spotlight tour, and the persistent help popover. `en` is the
// source of truth for the shape; `de` is typed `typeof en` to enforce parity.
// Key glyphs (⌘K) and product nouns (Node, Pipeline-Canvas) follow the existing
// catalogs' conventions.

export const en = {
  welcome: {
    badge: "Welcome to NotebookFlow",
    title: "Your notebooks, as one visual pipeline.",
    body: "Jupyter cells become nodes on a canvas — wire them together, run the whole graph, and watch results stream back in.",
    takeTour: "Take the tour",
    skip: "Skip for now",
  },
  tour: {
    back: "Back",
    next: "Next",
    finish: "Start building",
    skip: "Skip tour",
    progress: "Step {{current}} of {{total}}",
    stepLabel: "Guided tour",
  },
  steps: {
    files: {
      title: "A multi-notebook workspace",
      body: "All your open notebooks live here — this demo already links two of them. Drag any .ipynb file into the window to add your own.",
    },
    cells: {
      title: "Real Jupyter cells",
      body: "Edit code exactly as you would in Jupyter. Every change syncs to the canvas as you type.",
    },
    canvas: {
      title: "The pipeline canvas",
      body: "Every node is a cell; every wire is a data contract between them. Drag to rearrange, connect ports to pass data downstream.",
    },
    run: {
      title: "Run the whole graph",
      body: "Execute the pipeline end to end and watch live status pulse through every node.",
    },
    ask: {
      title: "Ask AI — ⌘K",
      body: "Ask questions, compose pipelines, or get explanations — powered by your own API key.",
    },
  },
  help: {
    label: "Help",
    replayTour: "Replay tour",
    shortcuts: "Keyboard shortcuts",
    documentation: "Documentation",
  },
};

export const de: typeof en = {
  welcome: {
    badge: "Willkommen bei NotebookFlow",
    title: "Deine Notebooks als eine visuelle Pipeline.",
    body: "Jupyter-Zellen werden zu Nodes auf einer Leinwand — verbinde sie, führe den ganzen Graphen aus und sieh zu, wie die Ergebnisse zurückfließen.",
    takeTour: "Tour starten",
    skip: "Erstmal überspringen",
  },
  tour: {
    back: "Zurück",
    next: "Weiter",
    finish: "Loslegen",
    skip: "Tour überspringen",
    progress: "Schritt {{current}} von {{total}}",
    stepLabel: "Geführte Tour",
  },
  steps: {
    files: {
      title: "Ein Workspace für mehrere Notebooks",
      body: "Alle offenen Notebooks leben hier — diese Demo verknüpft bereits zwei davon. Zieh eine beliebige .ipynb-Datei ins Fenster, um eigene hinzuzufügen.",
    },
    cells: {
      title: "Echte Jupyter-Zellen",
      body: "Bearbeite Code genau wie in Jupyter. Jede Änderung synchronisiert sich beim Tippen mit der Leinwand.",
    },
    canvas: {
      title: "Die Pipeline-Leinwand",
      body: "Jeder Node ist eine Zelle, jede Verbindung ein Datenvertrag. Ziehe Nodes zurecht und verbinde Ports, um Daten weiterzureichen.",
    },
    run: {
      title: "Den ganzen Graphen ausführen",
      body: "Führe die Pipeline von Anfang bis Ende aus und verfolge, wie der Live-Status durch jeden Node pulst.",
    },
    ask: {
      title: "KI fragen — ⌘K",
      body: "Stelle Fragen, komponiere Pipelines oder lass dir alles erklären — mit deinem eigenen API-Schlüssel.",
    },
  },
  help: {
    label: "Hilfe",
    replayTour: "Tour erneut ansehen",
    shortcuts: "Tastenkürzel",
    documentation: "Dokumentation",
  },
};
