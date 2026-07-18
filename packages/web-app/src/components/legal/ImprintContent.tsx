import type { ReactElement } from "react";
import { useI18n } from "@/lib/i18n";
import { CONTACT_EMAIL, OPERATOR_COUNTRY, OPERATOR_LOCATION, OPERATOR_NAME } from "@/lib/legal";
import { ContactForm } from "./ContactForm";
import { LegalDocument, LegalSection } from "./LegalDocument";

export function ImprintContent(): ReactElement {
  const { locale, t } = useI18n();
  return (
    <LegalDocument>
      <LegalSection id="provider-heading" title={t("legal.imprint.providerTitle")}>
        <p>{t("legal.imprint.providerBasis")}</p>
        <address className="not-italic text-foreground">
          <strong>{OPERATOR_NAME}</strong>
          <br />
          {OPERATOR_LOCATION}
          <br />
          {OPERATOR_COUNTRY[locale]}
        </address>
      </LegalSection>

      <LegalSection id="contact-heading" title={t("legal.imprint.contactTitle")}>
        <p>{t("legal.imprint.contactIntro")}</p>
        <p>
          {t("legal.imprint.emailLabel")}:{" "}
          <a
            className="text-primary underline-offset-4 hover:underline"
            href={`mailto:${CONTACT_EMAIL}`}
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </LegalSection>

      <ContactForm />
    </LegalDocument>
  );
}
