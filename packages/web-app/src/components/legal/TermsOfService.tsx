import type { ReactElement } from "react";

import { useI18n } from "@/lib/i18n";
import { LegalDocument, LegalSection } from "./LegalDocument";

const sectionKeys = [
  "provider",
  "service",
  "account",
  "content",
  "acceptable",
  "byok",
  "availability",
  "termination",
  "liability",
  "law",
  "changes",
  "contact",
] as const;

export function TermsOfService(): ReactElement {
  const { t } = useI18n();
  return (
    <LegalDocument>
      <p className="text-sm text-muted-foreground">{t("legal.terms.intro")}</p>
      {sectionKeys.map((key) => (
        <LegalSection key={key} id={`${key}-heading`} title={t(`legal.terms.${key}Title`)}>
          <p>{t(`legal.terms.${key}Body`)}</p>
        </LegalSection>
      ))}
    </LegalDocument>
  );
}
