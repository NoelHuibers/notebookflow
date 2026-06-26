// Settings dialog catalog (namespace: `settings`). `en` is the source of truth for
// the shape; `de` is typed as `typeof en` so the compiler enforces parity. Brand and
// provider/model names (NotebookFlow, Anthropic, OpenAI, Claude, GPT, …) stay in English.

export const en = {
  title: "Settings",
  close: "Close settings",
  language: "Language",

  // Account section.
  account: "Account",
  notSignedIn: "Not signed in — your work stays in this browser only.",

  // Engine URL override.
  engineUrlOverride: "Engine URL override",
  engineUrlPlaceholder: "ws://localhost:8765/ws  (leave blank to use VITE_NOTEBOOKFLOW_ENGINE_URL)",
  engineUrlHelp:
    "Connects to a different engine on the next pipeline run. Leave blank to use the env-var default.",

  // Theme.
  theme: "Theme",
  themeSystem: "Match system",
  themeLight: "Light",
  themeDark: "Dark",

  // AI provider (BYOK) block.
  providerSection: "AI provider (bring your own key)",
  provider: "Provider",
  model: "Model",
  modelPlaceholder: "(provider default)",
  apiKey: "API key",
  apiKeyPlaceholder: "sk-…",
  providerHelp:
    "Used for Ask / Compose / Explain / node synthesis. Stored in this browser and sent per request. Leave the key blank to use the engine's own key or the template fallback.",

  // Server-side key storage.
  saveKeyTitle: "Encrypt and store this key in your account so it loads on any device",
  saveKey: "Save key to account",
  saving: "Saving…",
  removeKey: "Remove from account",
  savedEncrypted: "Saved (encrypted)",
};

export const de: typeof en = {
  title: "Einstellungen",
  close: "Einstellungen schließen",
  language: "Sprache",

  account: "Konto",
  notSignedIn: "Nicht angemeldet – deine Arbeit bleibt nur in diesem Browser.",

  engineUrlOverride: "Engine-URL überschreiben",
  engineUrlPlaceholder:
    "ws://localhost:8765/ws  (leer lassen, um VITE_NOTEBOOKFLOW_ENGINE_URL zu nutzen)",
  engineUrlHelp:
    "Verbindet sich beim nächsten Pipeline-Lauf mit einer anderen Engine. Leer lassen, um den Standard aus der Umgebungsvariable zu nutzen.",

  theme: "Design",
  themeSystem: "Systemeinstellung folgen",
  themeLight: "Hell",
  themeDark: "Dunkel",

  providerSection: "KI-Anbieter (eigener Schlüssel)",
  provider: "Anbieter",
  model: "Modell",
  modelPlaceholder: "(Standard des Anbieters)",
  apiKey: "API-Schlüssel",
  apiKeyPlaceholder: "sk-…",
  providerHelp:
    "Wird für Ask / Compose / Explain / Node-Synthese verwendet. Wird in diesem Browser gespeichert und pro Anfrage gesendet. Lass den Schlüssel leer, um den eigenen Schlüssel der Engine oder den Vorlagen-Fallback zu nutzen.",

  saveKeyTitle:
    "Diesen Schlüssel verschlüsselt in deinem Konto speichern, damit er auf jedem Gerät geladen wird",
  saveKey: "Schlüssel im Konto speichern",
  saving: "Wird gespeichert…",
  removeKey: "Aus Konto entfernen",
  savedEncrypted: "Gespeichert (verschlüsselt)",
};
