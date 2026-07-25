// First-run onboarding catalog (namespace: `onboarding`) — the welcome moment,
// the eight-step spotlight tour, and the persistent help popover. `en` is the
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
      body: "Two notebooks are already open — preprocessing.ipynb and model_baseline.ipynb. Switch between them here, or drag any .ipynb file into the window to add your own.",
    },
    cells: {
      title: "Real Jupyter cells",
      body: "This is the active notebook, cell for cell. Edit the Python exactly as you would in Jupyter — every keystroke re-syncs the node it belongs to on the canvas.",
    },
    canvas: {
      title: "The pipeline canvas",
      body: "Each node is one cell; each wire is a data contract — an output port feeding a downstream input. Drag nodes to rearrange, or drag between ports to pass data along.",
    },
    connect: {
      title: "Notebooks, connected",
      body: "See the wire crossing between the two notebook groups? preprocessing's train/test split feeds straight into model_baseline's Train baseline node — one notebook's outputs become another's inputs, no glue code.",
    },
    palette: {
      title: "Add nodes from the palette",
      body: "Browse or search the node library, then drag any node onto the canvas to drop a new cell into the active notebook. Click a node instead to append it.",
    },
    run: {
      title: "Run the whole graph",
      body: "Hit Run to execute every node in dependency order across both notebooks, and watch live status pulse through each one as results stream back.",
    },
    triggers: {
      title: "Automate your runs",
      body: "Open Triggers to run the pipeline on a schedule (cron), when a file changes, or from a webhook — as well as on demand. Set it once and let it run.",
    },
    ask: {
      title: "Ask AI — ⌘K",
      body: "Press ⌘K to ask questions, compose whole pipelines, or explain a node — all running on your own provider key. Nothing leaves without it.",
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
      body: "Zwei Notebooks sind bereits offen — preprocessing.ipynb und model_baseline.ipynb. Wechsle hier zwischen ihnen oder zieh eine beliebige .ipynb-Datei ins Fenster, um eigene hinzuzufügen.",
    },
    cells: {
      title: "Echte Jupyter-Zellen",
      body: "Das ist das aktive Notebook, Zelle für Zelle. Bearbeite den Python-Code genau wie in Jupyter — jeder Tastendruck synchronisiert den zugehörigen Node auf der Leinwand neu.",
    },
    canvas: {
      title: "Die Pipeline-Leinwand",
      body: "Jeder Node ist eine Zelle, jede Verbindung ein Datenvertrag — ein Ausgabe-Port speist einen nachgelagerten Eingang. Ziehe Nodes zurecht oder verbinde Ports, um Daten weiterzureichen.",
    },
    connect: {
      title: "Notebooks, verbunden",
      body: "Siehst du die Verbindung zwischen den beiden Notebook-Gruppen? Der Train-/Test-Split aus preprocessing fließt direkt in den Train-baseline-Node von model_baseline — die Ausgaben des einen Notebooks werden zu den Eingaben des anderen, ganz ohne Klebe-Code.",
    },
    palette: {
      title: "Nodes aus der Palette hinzufügen",
      body: "Durchsuche die Node-Bibliothek und zieh einen beliebigen Node auf die Leinwand, um eine neue Zelle ins aktive Notebook einzufügen. Ein Klick hängt ihn stattdessen hinten an.",
    },
    run: {
      title: "Den ganzen Graphen ausführen",
      body: "Klick auf Ausführen, um alle Nodes über beide Notebooks hinweg in Abhängigkeitsreihenfolge laufen zu lassen — und verfolge, wie der Live-Status durch jeden Node pulst.",
    },
    triggers: {
      title: "Läufe automatisieren",
      body: "Öffne Trigger, um die Pipeline nach Zeitplan (Cron), bei Dateiänderungen oder per Webhook auszuführen — nicht nur auf Knopfdruck. Einmal einrichten und laufen lassen.",
    },
    ask: {
      title: "KI fragen — ⌘K",
      body: "Drück ⌘K, um Fragen zu stellen, ganze Pipelines zu komponieren oder einen Node erklären zu lassen — alles mit deinem eigenen Provider-Schlüssel. Ohne ihn geht nichts raus.",
    },
  },
  help: {
    label: "Hilfe",
    replayTour: "Tour erneut ansehen",
    shortcuts: "Tastenkürzel",
    documentation: "Dokumentation",
  },
};
