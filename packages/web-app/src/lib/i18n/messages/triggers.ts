// `triggers` namespace catalog for TriggersDialog (#20). `en` is the source of
// truth for the shape; `de` is typed `typeof en`, so the compiler enforces that it
// stays complete and in sync. Cron expressions and preset cron strings are data, not
// copy, so they are never translated. German uses informal "du"; the brand
// "NotebookFlow" and identifiers/units are left untranslated.

export const en = {
  // Dialog header + list chrome
  title: "Triggers",
  newTrigger: "New trigger",
  dismiss: "Dismiss",
  loading: "Loading triggers…",
  empty: "No triggers yet. Click 'New trigger' to register one.",

  // Trigger kind labels
  kindManual: "Manual",
  kindCron: "Cron",
  kindFileWatch: "File watch",
  kindWebhook: "Webhook",

  // Create form — fields
  triggerId: "Trigger id",
  cronExpressionLabel: "Cron expression (5 fields)",
  cronExpressionAria: "Cron expression",
  cronShapeWarning: "5 whitespace-separated fields expected; engine validates on save.",
  pathsLabel: "Paths (one per line)",
  pathsAria: "Paths to watch",
  pathsHint: "Engine-host paths. Directories are watched recursively.",

  // Create form — kind descriptions
  webhookDescription:
    "A POST URL will be generated after you save. Anyone posting to it fires this trigger.",
  manualDescriptionPrefix: "Fires only when you click ",
  manualDescriptionFireNow: "Fire now",
  manualDescriptionSuffix: " in the list.",

  // Create form — validation errors
  errorIdEmpty: "Trigger id can't be empty.",
  errorCronRequired: "Cron expression required.",
  errorPathRequired: "Add at least one path to watch.",
  errorUnknown: "unknown error",

  // Create form — actions
  saving: "Saving…",
  saveTrigger: "Save trigger",
  cancel: "Cancel",

  // Cron presets
  presetEvery5Min: "Every 5 min",
  presetHourly: "Hourly",
  presetDaily9am: "Daily 9am",

  // List item — actions + accessibility
  collapseTrigger: "Collapse trigger",
  expandTrigger: "Expand trigger",
  fireNow: "Fire now",
  deleteTrigger: "Delete trigger",
  firingsCount_one: "{{count}} firing",
  firingsCount_other: "{{count}} firings",

  // List item — action errors
  fireFailed: "Fire failed: {{message}}",
  deleteFailed: "Delete failed: {{message}}",
  copyFailed: "Copy failed; select the URL manually.",

  // List item — webhook detail
  copyUrl: "Copy URL",
  copied: "Copied",
  webhookBodyHint: 'Content-Type: application/json · Body: {"payload": {...}}',
  webhookAuthHint:
    "If NOTEBOOKFLOW_AUTH_TOKEN is set on your engine, include Authorization: Bearer <token>.",

  // List item — firings detail
  firingsHeading: "Firings (last {{count}})",
  firingsRefreshNote: " · refreshes every 5s",
  noFirings: "No firings yet.",
};

export const de: typeof en = {
  // Dialog header + list chrome
  title: "Trigger",
  newTrigger: "Neuer Trigger",
  dismiss: "Schließen",
  loading: "Trigger werden geladen…",
  empty: "Noch keine Trigger. Klicke auf „Neuer Trigger“, um einen zu registrieren.",

  // Trigger kind labels
  kindManual: "Manuell",
  kindCron: "Cron",
  kindFileWatch: "Dateiüberwachung",
  kindWebhook: "Webhook",

  // Create form — fields
  triggerId: "Trigger-ID",
  cronExpressionLabel: "Cron-Ausdruck (5 Felder)",
  cronExpressionAria: "Cron-Ausdruck",
  cronShapeWarning:
    "5 durch Leerzeichen getrennte Felder erwartet; die Engine prüft beim Speichern.",
  pathsLabel: "Pfade (einer pro Zeile)",
  pathsAria: "Zu überwachende Pfade",
  pathsHint: "Pfade auf dem Engine-Host. Verzeichnisse werden rekursiv überwacht.",

  // Create form — kind descriptions
  webhookDescription:
    "Nach dem Speichern wird eine POST-URL generiert. Jeder, der darauf postet, löst diesen Trigger aus.",
  manualDescriptionPrefix: "Wird nur ausgelöst, wenn du in der Liste auf ",
  manualDescriptionFireNow: "Jetzt auslösen",
  manualDescriptionSuffix: " klickst.",

  // Create form — validation errors
  errorIdEmpty: "Die Trigger-ID darf nicht leer sein.",
  errorCronRequired: "Cron-Ausdruck erforderlich.",
  errorPathRequired: "Füge mindestens einen zu überwachenden Pfad hinzu.",
  errorUnknown: "unbekannter Fehler",

  // Create form — actions
  saving: "Wird gespeichert…",
  saveTrigger: "Trigger speichern",
  cancel: "Abbrechen",

  // Cron presets
  presetEvery5Min: "Alle 5 Min",
  presetHourly: "Stündlich",
  presetDaily9am: "Täglich 9 Uhr",

  // List item — actions + accessibility
  collapseTrigger: "Trigger einklappen",
  expandTrigger: "Trigger ausklappen",
  fireNow: "Jetzt auslösen",
  deleteTrigger: "Trigger löschen",
  firingsCount_one: "{{count}} Auslösung",
  firingsCount_other: "{{count}} Auslösungen",

  // List item — action errors
  fireFailed: "Auslösen fehlgeschlagen: {{message}}",
  deleteFailed: "Löschen fehlgeschlagen: {{message}}",
  copyFailed: "Kopieren fehlgeschlagen; wähle die URL manuell aus.",

  // List item — webhook detail
  copyUrl: "URL kopieren",
  copied: "Kopiert",
  webhookBodyHint: 'Content-Type: application/json · Body: {"payload": {...}}',
  webhookAuthHint:
    "Wenn NOTEBOOKFLOW_AUTH_TOKEN auf deiner Engine gesetzt ist, füge Authorization: Bearer <token> hinzu.",

  // List item — firings detail
  firingsHeading: "Auslösungen (letzte {{count}})",
  firingsRefreshNote: " · aktualisiert alle 5 s",
  noFirings: "Noch keine Auslösungen.",
};
