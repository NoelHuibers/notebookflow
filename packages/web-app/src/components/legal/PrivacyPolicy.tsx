import type { ReactElement } from "react";

import { PrivacyStorageDisclosure } from "@/components/PrivacyStorageDisclosure";
import { useI18n } from "@/lib/i18n";
import { LegalDocument, LegalSection } from "./LegalDocument";

const dataKeys = ["account", "workspace", "key", "execution", "technical"] as const;
const basisKeys = ["service", "security", "law"] as const;

export function PrivacyPolicy(): ReactElement {
  const { t } = useI18n();
  return (
    <LegalDocument>
      <p className="text-sm text-muted-foreground">{t("legal.privacy.intro")}</p>

      <LegalSection id="controller-heading" title={t("legal.privacy.controllerTitle")}>
        <p>{t("legal.privacy.controllerBody")}</p>
      </LegalSection>

      <LegalSection id="data-heading" title={t("legal.privacy.dataTitle")}>
        <ul className="list-disc space-y-2 pl-5">
          {dataKeys.map((key) => (
            <li key={key}>{t(`legal.privacy.data.${key}`)}</li>
          ))}
        </ul>
      </LegalSection>

      <LegalSection id="oauth-heading" title={t("legal.privacy.oauthTitle")}>
        <p>{t("legal.privacy.oauthBody")}</p>
      </LegalSection>

      <LegalSection id="hosting-heading" title={t("legal.privacy.hostingTitle")}>
        <p>{t("legal.privacy.hostingBody")}</p>
      </LegalSection>

      <LegalSection id="contact-data-heading" title={t("legal.privacy.contactTitle")}>
        <p>{t("legal.privacy.contactBody")}</p>
      </LegalSection>

      <LegalSection id="bases-heading" title={t("legal.privacy.basesTitle")}>
        <ul className="list-disc space-y-2 pl-5">
          {basisKeys.map((key) => (
            <li key={key}>{t(`legal.privacy.bases.${key}`)}</li>
          ))}
        </ul>
      </LegalSection>

      <LegalSection id="recipients-heading" title={t("legal.privacy.recipientsTitle")}>
        <p>{t("legal.privacy.recipientsBody")}</p>
      </LegalSection>

      <LegalSection id="retention-heading" title={t("legal.privacy.retentionTitle")}>
        <p>{t("legal.privacy.retentionBody")}</p>
      </LegalSection>

      <LegalSection id="required-heading" title={t("legal.privacy.requiredTitle")}>
        <p>{t("legal.privacy.requiredBody")}</p>
      </LegalSection>

      <LegalSection id="rights-heading" title={t("legal.privacy.rightsTitle")}>
        <p>{t("legal.privacy.rightsBody")}</p>
      </LegalSection>

      <LegalSection id="complaint-heading" title={t("legal.privacy.complaintTitle")}>
        <p>{t("legal.privacy.complaintBody")}</p>
        <a
          className="text-primary underline-offset-4 hover:underline"
          href="https://www.lda.bayern.de/"
          rel="noreferrer"
          target="_blank"
        >
          www.lda.bayern.de
        </a>
      </LegalSection>

      <LegalSection id="automation-heading" title={t("legal.privacy.automationTitle")}>
        <p>{t("legal.privacy.automationBody")}</p>
      </LegalSection>

      <LegalSection id="security-heading" title={t("legal.privacy.securityTitle")}>
        <p>{t("legal.privacy.securityBody")}</p>
      </LegalSection>

      <PrivacyStorageDisclosure />

      <LegalSection id="changes-heading" title={t("legal.privacy.changesTitle")}>
        <p>{t("legal.privacy.changesBody")}</p>
      </LegalSection>
    </LegalDocument>
  );
}
