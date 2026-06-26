// DE + EN message catalogs. Structured by namespace so marketing, app, and legal
// surfaces can share keys. `en` is the source of truth for the shape; `de` is typed
// as `Messages`, so the compiler enforces that it stays complete and in sync.
//
// Scope today: the public chrome (login, legal, 404) is fully translated. The editor
// (App.tsx + dialogs, ~150+ strings) is intentionally deferred — add namespaces here
// and swap literals for `t(...)` incrementally without touching the foundation.

export const en = {
  common: {
    launchApp: "Launch app",
    signIn: "Sign in",
    signOut: "Sign out",
    back: "← Back",
    backHome: "← Back to home",
    home: "Home",
  },
  login: {
    loading: "Loading…",
    checkingSession: "Checking your session…",
    signedInAs: "Signed in as",
    welcome: "Welcome to NotebookFlow",
    subtitle: "Sign in to save your work and run pipelines.",
    continueGithub: "Continue with GitHub",
    continueGoogle: "Continue with Google",
    betaNote: "Private beta — access is limited while we're testing.",
  },
  legal: {
    placeholder:
      "This page is a placeholder — the full bilingual (DE + EN) content is coming soon.",
    impressum: "Legal notice",
    datenschutz: "Privacy policy",
    agb: "Terms of service",
  },
  notFound: {
    code: "404",
    title: "Page not found",
    body: "That page doesn't exist or has moved.",
  },
  settings: {
    language: "Language",
  },
};

export type Messages = typeof en;

export const de: Messages = {
  common: {
    launchApp: "App öffnen",
    signIn: "Anmelden",
    signOut: "Abmelden",
    back: "← Zurück",
    backHome: "← Zurück zur Startseite",
    home: "Startseite",
  },
  login: {
    loading: "Wird geladen…",
    checkingSession: "Sitzung wird geprüft…",
    signedInAs: "Angemeldet als",
    welcome: "Willkommen bei NotebookFlow",
    subtitle: "Melde dich an, um deine Arbeit zu speichern und Pipelines auszuführen.",
    continueGithub: "Mit GitHub fortfahren",
    continueGoogle: "Mit Google fortfahren",
    betaNote: "Private Beta – der Zugang ist während der Testphase begrenzt.",
  },
  legal: {
    placeholder:
      "Diese Seite ist ein Platzhalter – die vollständigen Inhalte (DE + EN) folgen in Kürze.",
    impressum: "Impressum",
    datenschutz: "Datenschutzerklärung",
    agb: "Nutzungsbedingungen (AGB)",
  },
  notFound: {
    code: "404",
    title: "Seite nicht gefunden",
    body: "Diese Seite existiert nicht oder wurde verschoben.",
  },
  settings: {
    language: "Sprache",
  },
};
