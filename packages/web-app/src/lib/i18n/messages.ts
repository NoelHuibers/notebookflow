// DE + EN message catalogs, assembled from per-namespace modules in ./messages/.
// Each module exports `en` and `de: typeof en`, so the compiler enforces key parity
// within a namespace; `de: Messages` below enforces the whole shape matches `en`.
//
// `common`, `login`, `legal`, and `notFound` are small and stable, so they stay
// inline here; every larger surface (app, landing, dialogs, cells, files, …) lives
// in its own module under ./messages/ so it can grow independently.

import * as app from "./messages/app";
import * as ask from "./messages/ask";
import * as canvas from "./messages/canvas";
import * as cells from "./messages/cells";
import * as cloud from "./messages/cloud";
import * as compose from "./messages/compose";
import * as explanation from "./messages/explanation";
import * as files from "./messages/files";
import * as landing from "./messages/landing";
import * as palette from "./messages/palette";
import * as settings from "./messages/settings";
import * as shortcuts from "./messages/shortcuts";
import * as triggers from "./messages/triggers";

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
  app: app.en,
  canvas: canvas.en,
  landing: landing.en,
  settings: settings.en,
  shortcuts: shortcuts.en,
  compose: compose.en,
  cloud: cloud.en,
  ask: ask.en,
  palette: palette.en,
  explanation: explanation.en,
  triggers: triggers.en,
  cells: cells.en,
  files: files.en,
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
  app: app.de,
  canvas: canvas.de,
  landing: landing.de,
  settings: settings.de,
  shortcuts: shortcuts.de,
  compose: compose.de,
  cloud: cloud.de,
  ask: ask.de,
  palette: palette.de,
  explanation: explanation.de,
  triggers: triggers.de,
  cells: cells.de,
  files: files.de,
};
