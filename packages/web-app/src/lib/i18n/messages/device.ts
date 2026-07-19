// `device` namespace — the /device approval page for the OAuth
// device-authorization flow (#88): VS Code / JupyterLab show a user code and
// send people here to approve or deny the sign-in.
export const en = {
  title: "Device sign-in",
  loading: "Loading…",
  checkingSession: "Checking your session…",
  signInPrompt: "Sign in to approve the sign-in request from your editor.",
  enterCodeTitle: "Enter your code",
  enterCodePrompt: "Enter the code shown in your editor extension.",
  codePlaceholder: "e.g. ABCD1234",
  continue: "Continue",
  verifying: "Checking the code…",
  confirmTitle: "Approve this device?",
  confirmBody:
    "An editor extension wants to access your NotebookFlow account. Approve only if this code matches the one shown in your editor.",
  approve: "Approve",
  deny: "Deny",
  working: "Working…",
  approvedTitle: "Device approved",
  approvedBody: "You're signed in. You can close this tab and return to your editor.",
  deniedTitle: "Request denied",
  deniedBody: "The device was not signed in. You can close this tab.",
  alreadyHandled: "This code has already been used. Request a new code from your editor.",
  invalidCode: "That code is invalid or has expired. Request a new code from your editor.",
  requestFailed: "Something went wrong. Please try again.",
  useDifferentCode: "Use a different code",
};

export const de: typeof en = {
  title: "Geräteanmeldung",
  loading: "Wird geladen…",
  checkingSession: "Sitzung wird geprüft…",
  signInPrompt: "Melde dich an, um die Anmeldeanfrage aus deinem Editor zu bestätigen.",
  enterCodeTitle: "Code eingeben",
  enterCodePrompt: "Gib den Code ein, der in deiner Editor-Erweiterung angezeigt wird.",
  codePlaceholder: "z. B. ABCD1234",
  continue: "Weiter",
  verifying: "Code wird geprüft…",
  confirmTitle: "Dieses Gerät bestätigen?",
  confirmBody:
    "Eine Editor-Erweiterung möchte auf dein NotebookFlow-Konto zugreifen. Bestätige nur, wenn dieser Code mit dem in deinem Editor angezeigten übereinstimmt.",
  approve: "Bestätigen",
  deny: "Ablehnen",
  working: "Wird verarbeitet…",
  approvedTitle: "Gerät bestätigt",
  approvedBody:
    "Du bist angemeldet. Du kannst diesen Tab schließen und zu deinem Editor zurückkehren.",
  deniedTitle: "Anfrage abgelehnt",
  deniedBody: "Das Gerät wurde nicht angemeldet. Du kannst diesen Tab schließen.",
  alreadyHandled:
    "Dieser Code wurde bereits verwendet. Fordere in deinem Editor einen neuen Code an.",
  invalidCode:
    "Dieser Code ist ungültig oder abgelaufen. Fordere in deinem Editor einen neuen Code an.",
  requestFailed: "Etwas ist schiefgelaufen. Bitte versuche es erneut.",
  useDifferentCode: "Anderen Code verwenden",
};
