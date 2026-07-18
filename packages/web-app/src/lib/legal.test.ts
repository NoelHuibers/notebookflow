import { describe, expect, it } from "vitest";

import { CONTACT_EMAIL, createContactMailto } from "./legal";

describe("createContactMailto", () => {
  it("encodes the contact fields for the operator", () => {
    const target = createContactMailto(
      {
        name: "  Ada Lovelace  ",
        replyTo: " ada@example.com ",
        subject: " A question & follow-up ",
        message: " Hello,\nNotebookFlow! ",
      },
      "Contact request",
    );

    const url = new URL(target);
    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe(CONTACT_EMAIL);
    expect(url.searchParams.get("subject")).toBe("[NotebookFlow] A question & follow-up");
    expect(url.searchParams.get("body")).toBe(
      "Name: Ada Lovelace\nReply-to: ada@example.com\n\nHello,\nNotebookFlow!",
    );
  });

  it("uses the localized fallback when the subject is blank", () => {
    const target = createContactMailto(
      { name: "Ada", replyTo: "ada@example.com", subject: "  ", message: "Hello" },
      "Kontaktanfrage",
    );

    expect(new URL(target).searchParams.get("subject")).toBe("[NotebookFlow] Kontaktanfrage");
  });
});
