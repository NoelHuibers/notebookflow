// Landing-page marketing copy. The `<accent>` / `<code>` tags are rendered via
// react-i18next's <Trans> (see LandingHero.tsx / index.tsx). Code snippets inside
// the tags (# @node:, .ipynb, data:Node.port) are product syntax — kept verbatim
// in both locales. The hero graph's node names stay English: they mirror the
// bundled example notebook markers, so translating them would desync the
// diagram from the code it depicts.
export const en = {
  badge: "Private beta",
  heroTitle: "n8n for your <accent>notebooks</accent>.",
  heroSubtitle:
    "Turn notebooks and cell groups into visual pipelines — with AI assistance, bring-your-own-key models, and bidirectional sync across the web, VS Code, and JupyterLab.",
  scroll: "Scroll",

  cap1Kicker: "A notebook is a graph",
  cap1Body:
    "Mark cell groups with <code># @node:</code> and NotebookFlow derives the DAG. Your <code>.ipynb</code> stays the source of truth.",
  cap2Kicker: "Notebooks link to notebooks",
  cap2Body:
    "Wire outputs across files with cross-notebook refs — <code>data:Node.port</code>. Reuse whole pipelines like functions.",
  cap3Kicker: "Run it",
  cap3Body:
    "Execute in dependency order. Stream results, charts, and AI output straight back into your cells.",

  featuresHeading: "A notebook that thinks in pipelines",
  f1Title: "Visual pipeline canvas",
  f1Body:
    "Drag cells and notebooks onto a canvas and wire them into a DAG. The same graph, edited from either side — code and canvas stay in sync.",
  f2Title: "AI woven in",
  f2Body:
    "Generate nodes from a prompt, explain a pipeline in plain English, or ask anything with ⌘K — right where you work.",
  f3Title: "Bring your own key",
  f3Body:
    "Use your own OpenAI, Anthropic, or other provider key. Stored encrypted at rest, decrypted only to make the call — never harvested.",
  f4Title: "Runs anywhere",
  f4Body:
    "One engine behind the web app, VS Code, and JupyterLab — or point at your own. Your notebooks, your compute.",

  step1Title: "Bring your data",
  step1Body: "Drop a notebook or a CSV, or start from a template.",
  step2Title: "Wire it up",
  step2Body: "Compose cells and notebooks into a pipeline on the canvas.",
  step3Title: "Run it",
  step3Body: "Stream results, charts, and AI output back into your cells.",

  ctaHeading: "Ready to wire up your first pipeline?",
  runOk: "5 nodes ok",

  footerImpressum: "Legal notice",
  footerPrivacy: "Privacy",
  footerTerms: "Terms",
};

export const de: typeof en = {
  badge: "Private Beta",
  heroTitle: "n8n für deine <accent>Notebooks</accent>.",
  heroSubtitle:
    "Verwandle Notebooks und Zellgruppen in visuelle Pipelines – mit KI-Unterstützung, eigenen API-Schlüsseln und bidirektionaler Synchronisation über Web, VS Code und JupyterLab.",
  scroll: "Scrollen",

  cap1Kicker: "Ein Notebook ist ein Graph",
  cap1Body:
    "Markiere Zellgruppen mit <code># @node:</code> und NotebookFlow leitet den DAG ab. Deine <code>.ipynb</code> bleibt die Quelle der Wahrheit.",
  cap2Kicker: "Notebooks verbinden sich mit Notebooks",
  cap2Body:
    "Verdrahte Ausgaben über Dateien hinweg mit notebookübergreifenden Referenzen – <code>data:Node.port</code>. Verwende ganze Pipelines wie Funktionen wieder.",
  cap3Kicker: "Führ es aus",
  cap3Body:
    "Führe in Abhängigkeitsreihenfolge aus. Streame Ergebnisse, Diagramme und KI-Ausgaben direkt zurück in deine Zellen.",

  featuresHeading: "Ein Notebook, das in Pipelines denkt",
  f1Title: "Visueller Pipeline-Canvas",
  f1Body:
    "Zieh Zellen und Notebooks auf einen Canvas und verdrahte sie zu einem DAG. Derselbe Graph, von beiden Seiten bearbeitet – Code und Canvas bleiben synchron.",
  f2Title: "KI integriert",
  f2Body:
    "Erzeuge Knoten aus einem Prompt, erkläre eine Pipeline in klarem Deutsch oder frag alles mit ⌘K – direkt dort, wo du arbeitest.",
  f3Title: "Bring deinen eigenen Schlüssel mit",
  f3Body:
    "Nutze deinen eigenen OpenAI-, Anthropic- oder anderen Anbieter-Schlüssel. Verschlüsselt gespeichert, nur für den Aufruf entschlüsselt – niemals abgegriffen.",
  f4Title: "Läuft überall",
  f4Body:
    "Eine Engine hinter Web-App, VS Code und JupyterLab – oder zeig auf deine eigene. Deine Notebooks, deine Rechenleistung.",

  step1Title: "Bring deine Daten",
  step1Body: "Lege ein Notebook oder eine CSV ab – oder starte mit einer Vorlage.",
  step2Title: "Verdrahte es",
  step2Body: "Stelle Zellen und Notebooks auf dem Canvas zu einer Pipeline zusammen.",
  step3Title: "Führ es aus",
  step3Body: "Streame Ergebnisse, Diagramme und KI-Ausgaben zurück in deine Zellen.",

  ctaHeading: "Bereit, deine erste Pipeline zu verdrahten?",
  runOk: "5 Knoten OK",

  footerImpressum: "Impressum",
  footerPrivacy: "Datenschutz",
  footerTerms: "AGB",
};
