import type { ReactElement } from "react";
import { useI18n } from "@/lib/i18n";
import {
  CONTACT_EMAIL,
  OPERATOR_ADDRESS_LINES,
  OPERATOR_COUNTRY,
  OPERATOR_NAME,
  OPERATOR_PHONE,
  OPERATOR_PHONE_HREF,
} from "@/lib/legal";
import { ContactForm } from "./ContactForm";
import { LegalDocument, LegalSection } from "./LegalDocument";

function OperatorAddress({ locale }: { locale: keyof typeof OPERATOR_COUNTRY }): ReactElement {
  return (
    <address className="not-italic text-foreground">
      <strong>{OPERATOR_NAME}</strong>
      {[...OPERATOR_ADDRESS_LINES, OPERATOR_COUNTRY[locale]].map((line) => (
        <span key={line}>
          <br />
          {line}
        </span>
      ))}
    </address>
  );
}

export function ImprintContent(): ReactElement {
  const { locale, t } = useI18n();
  return (
    <LegalDocument>
      <LegalSection id="provider-heading" title={t("legal.imprint.providerTitle")}>
        <p>{t("legal.imprint.providerBasis")}</p>
        <OperatorAddress locale={locale} />
      </LegalSection>

      <LegalSection id="contact-heading" title={t("legal.imprint.contactTitle")}>
        <p>{t("legal.imprint.contactIntro")}</p>
        <p>
          {t("legal.imprint.phoneLabel")}:{" "}
          <a className="text-primary underline-offset-4 hover:underline" href={OPERATOR_PHONE_HREF}>
            {OPERATOR_PHONE[locale]}
          </a>
          <br />
          {t("legal.imprint.emailLabel")}:{" "}
          <a
            className="text-primary underline-offset-4 hover:underline"
            href={`mailto:${CONTACT_EMAIL}`}
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </LegalSection>

      <LegalSection id="editorial-heading" title={t("legal.imprint.editorialTitle")}>
        <OperatorAddress locale={locale} />
      </LegalSection>

      <ContactForm />
    </LegalDocument>
  );
}
