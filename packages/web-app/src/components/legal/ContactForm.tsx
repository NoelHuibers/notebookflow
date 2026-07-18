import { Link } from "@tanstack/react-router";
import type { FormEvent, ReactElement } from "react";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { CONTACT_EMAIL, createContactMailto } from "@/lib/legal";

const inputClassName =
  "mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

export function ContactForm(): ReactElement {
  const { t } = useI18n();
  const [opened, setOpened] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const target = createContactMailto(
      {
        name: String(form.get("name") ?? ""),
        replyTo: String(form.get("email") ?? ""),
        subject: String(form.get("subject") ?? ""),
        message: String(form.get("message") ?? ""),
      },
      t("legal.contact.fallbackSubject"),
    );
    setOpened(true);
    window.location.assign(target);
  }

  return (
    <div id="contact" className="scroll-mt-24 rounded-lg border border-border/70 p-5">
      <h3 className="font-semibold">{t("legal.imprint.formTitle")}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground">{t("legal.imprint.formIntro")}</p>
      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            {t("legal.contact.nameLabel")}
            <input className={inputClassName} name="name" autoComplete="name" required />
          </label>
          <label className="text-sm font-medium">
            {t("legal.contact.emailLabel")}
            <input
              className={inputClassName}
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </label>
        </div>
        <label className="block text-sm font-medium">
          {t("legal.contact.subjectLabel")}
          <input className={inputClassName} name="subject" required />
        </label>
        <label className="block text-sm font-medium">
          {t("legal.contact.messageLabel")}
          <textarea className={`${inputClassName} min-h-36 resize-y`} name="message" required />
        </label>
        <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
          <input
            className="mt-1 size-4 accent-primary"
            name="acknowledgement"
            type="checkbox"
            required
          />
          <span>
            {t("legal.contact.consentLabel")}{" "}
            <Link
              to="/legal/datenschutz"
              className="text-primary underline-offset-4 hover:underline"
            >
              {t("legal.datenschutz")}
            </Link>
          </span>
        </label>
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
        >
          {t("legal.contact.submit")}
        </button>
      </form>
      <p className="mt-4 text-sm text-muted-foreground">
        {t("legal.contact.directPrefix")}{" "}
        <a
          className="text-primary underline-offset-4 hover:underline"
          href={`mailto:${CONTACT_EMAIL}`}
        >
          {CONTACT_EMAIL}
        </a>
        .
      </p>
      {opened && (
        <p className="mt-3 rounded-md bg-muted p-3 text-sm" role="status">
          {t("legal.contact.opened")}
        </p>
      )}
    </div>
  );
}
