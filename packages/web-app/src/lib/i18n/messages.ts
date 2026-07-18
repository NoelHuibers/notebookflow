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
    privacy: {
      provisional:
        "This section documents the cookies and local browser storage currently used by NotebookFlow. The complete privacy policy, including service-provider details and data-subject rights, will be added before public launch.",
      storageTitle: "Cookies and local browser storage",
      storageIntro:
        "NotebookFlow currently uses the following first-party storage for sign-in and user-selected functionality.",
      labels: {
        names: "Name",
        category: "Classification",
        purpose: "Purpose",
        retention: "Retention",
      },
      entries: {
        session: {
          title: "Signed-in session cookie",
          category: "Essential",
          purpose:
            "Keeps you signed in and authenticates account requests. The cookie is HttpOnly, SameSite=Lax, and Secure in production.",
          retention: "Up to seven days; deleted when you sign out.",
        },
        oauth: {
          title: "Temporary OAuth state cookie",
          category: "Essential",
          purpose:
            "Protects GitHub and Google sign-in by correlating the sign-in request with its callback. The cookie is HttpOnly, SameSite=Lax, and Secure in production.",
          retention: "Up to ten minutes.",
        },
        locale: {
          title: "Language preference cookie",
          category: "Functional (selected by you)",
          purpose:
            "Remembers the language you explicitly select so server-rendered and browser-rendered pages use the same language.",
          retention: "One year, or until you delete it in your browser.",
        },
        settings: {
          title: "Application settings",
          category: "Functional (selected by you)",
          purpose:
            "Stores your engine URL, theme, model/provider, and optional BYOK API key in this browser. A key is stored in your account only if you explicitly choose that option; the active key is sent when you make an AI request.",
          retention: "Until you change the settings or clear this site's browser storage.",
        },
        panels: {
          title: "Panel layout",
          category: "Functional (selected by you)",
          purpose:
            "Remembers which workspace panels you collapsed. The v1 name is read only to preserve layouts saved by older versions.",
          retention: "Until you change the layout or clear this site's browser storage.",
        },
      },
      analyticsTitle: "Analytics and tracking",
      analyticsBody:
        "NotebookFlow currently uses no analytics, advertising, cross-site tracking, or tracking cookies.",
      consentTitle: "Consent posture",
      consentBody:
        "No consent banner is currently shown because storage is limited to essential sign-in technology and functionality you request, and no analytics or tracking is enabled. If non-essential storage or tracking is introduced, it will remain disabled until you opt in and this disclosure is updated.",
      legalBasis:
        "Storage on your device is assessed under Section 25(2)(2) TDDDG. This implementation disclosure is not a substitute for final legal review.",
    },
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
    privacy: {
      provisional:
        "Dieser Abschnitt dokumentiert die derzeit von NotebookFlow verwendeten Cookies und lokalen Browserspeicher. Die vollständige Datenschutzerklärung mit Angaben zu Dienstleistern und Betroffenenrechten wird vor dem öffentlichen Start ergänzt.",
      storageTitle: "Cookies und lokaler Browserspeicher",
      storageIntro:
        "NotebookFlow verwendet derzeit die folgenden eigenen Speichertechniken für die Anmeldung und ausdrücklich gewählte Funktionen.",
      labels: {
        names: "Name",
        category: "Einordnung",
        purpose: "Zweck",
        retention: "Speicherdauer",
      },
      entries: {
        session: {
          title: "Cookie für die angemeldete Sitzung",
          category: "Technisch notwendig",
          purpose:
            "Hält die Anmeldung aufrecht und authentifiziert Kontoanfragen. Das Cookie ist HttpOnly, SameSite=Lax und in der Produktion Secure.",
          retention: "Höchstens sieben Tage; wird beim Abmelden gelöscht.",
        },
        oauth: {
          title: "Temporäres OAuth-Status-Cookie",
          category: "Technisch notwendig",
          purpose:
            "Schützt die Anmeldung mit GitHub und Google, indem Anmeldeanfrage und Rückruf einander zugeordnet werden. Das Cookie ist HttpOnly, SameSite=Lax und in der Produktion Secure.",
          retention: "Höchstens zehn Minuten.",
        },
        locale: {
          title: "Cookie für die Sprachauswahl",
          category: "Funktional (ausdrücklich ausgewählt)",
          purpose:
            "Speichert die ausdrücklich ausgewählte Sprache, damit server- und browserseitig gerenderte Seiten dieselbe Sprache verwenden.",
          retention: "Ein Jahr oder bis zur Löschung im Browser.",
        },
        settings: {
          title: "Anwendungseinstellungen",
          category: "Funktional (ausdrücklich ausgewählt)",
          purpose:
            "Speichert Engine-URL, Theme, Modell/Anbieter und optional den BYOK-API-Schlüssel in diesem Browser. Ein Schlüssel wird nur nach ausdrücklicher Auswahl im Konto gespeichert; der aktive Schlüssel wird bei einer KI-Anfrage übermittelt.",
          retention:
            "Bis zur Änderung der Einstellungen oder zum Löschen des Website-Speichers im Browser.",
        },
        panels: {
          title: "Panel-Anordnung",
          category: "Funktional (ausdrücklich ausgewählt)",
          purpose:
            "Speichert, welche Arbeitsbereich-Panels eingeklappt wurden. Der v1-Name wird nur gelesen, um mit älteren Versionen gespeicherte Anordnungen zu erhalten.",
          retention:
            "Bis zur Änderung der Anordnung oder zum Löschen des Website-Speichers im Browser.",
        },
      },
      analyticsTitle: "Analyse und Tracking",
      analyticsBody:
        "NotebookFlow verwendet derzeit keine Analyse-, Werbe- oder websiteübergreifenden Tracking-Techniken und keine Tracking-Cookies.",
      consentTitle: "Einwilligungsstatus",
      consentBody:
        "Derzeit wird kein Einwilligungsbanner angezeigt, da die Speicherung auf notwendige Anmeldetechnik und ausdrücklich gewählte Funktionen beschränkt ist und weder Analyse noch Tracking aktiviert sind. Künftige nicht notwendige Speicherung oder Tracking bleiben deaktiviert, bis eine aktive Einwilligung erteilt und diese Information aktualisiert wurde.",
      legalBasis:
        "Die Speicherung auf dem Endgerät wird nach § 25 Abs. 2 Nr. 2 TDDDG bewertet. Diese technische Information ersetzt keine abschließende rechtliche Prüfung.",
    },
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
