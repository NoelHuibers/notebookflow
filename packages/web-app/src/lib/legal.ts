export const OPERATOR_NAME = "Noel Huibers";
export const OPERATOR_ADDRESS_LINES = [
  "c/o Impressumservice Dein-Impressum",
  "Stettiner Str. 41",
  "35410 Hungen",
] as const;
export const OPERATOR_COUNTRY = { en: "Germany", de: "Deutschland" } as const;
export const OPERATOR_PHONE = { en: "+49 157 9234 1658", de: "0157 9234 1658" } as const;
export const OPERATOR_PHONE_HREF = "tel:+4915792341658";
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
