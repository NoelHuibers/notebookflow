export const OPERATOR_NAME = "Noel Huibers";
export const OPERATOR_LOCATION = "81737 München";
export const OPERATOR_COUNTRY = { en: "Germany", de: "Deutschland" } as const;
export const CONTACT_EMAIL = "notebookflow@huibers.io";

export interface ContactMessage {
  name: string;
  replyTo: string;
  subject: string;
  message: string;
}

/** Build the mailto target used by the client-only contact form. */
export function createContactMailto(values: ContactMessage, fallbackSubject: string): string {
  const subject = values.subject.trim() || fallbackSubject;
  const body = [
    `Name: ${values.name.trim()}`,
    `Reply-to: ${values.replyTo.trim()}`,
    "",
    values.message.trim(),
  ].join("\n");
  const query = new URLSearchParams({
    subject: `[NotebookFlow] ${subject}`,
    body,
  });
  return `mailto:${CONTACT_EMAIL}?${query.toString()}`;
}
