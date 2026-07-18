import type { ReactElement } from "react";

import { useI18n } from "@/lib/i18n";

const storageEntries = [
  {
    id: "session",
    names: ["__Secure-better-auth.session_token", "better-auth.session_token"],
  },
  {
    id: "oauth",
    names: ["__Secure-better-auth.oauth_state", "better-auth.oauth_state"],
  },
  { id: "locale", names: ["nf_locale"] },
  { id: "settings", names: ["notebookflow.settings.v1"] },
  { id: "panels", names: ["notebookflow.panels.v2", "notebookflow.panels.v1"] },
] as const;

export function PrivacyStorageDisclosure(): ReactElement {
  const { t } = useI18n();

  return (
    <div className="space-y-9 leading-relaxed">
      <section aria-labelledby="storage-heading">
        <h2 id="storage-heading" className="text-xl font-semibold tracking-tight">
          {t("legal.privacy.storageTitle")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("legal.privacy.storageIntro")}</p>

        <ul className="mt-5 space-y-4">
          {storageEntries.map((entry) => (
            <li key={entry.id} className="rounded-md border border-border/70 p-4">
              <h3 className="font-semibold">{t(`legal.privacy.entries.${entry.id}.title`)}</h3>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-muted-foreground">
                    {t("legal.privacy.labels.names")}
                  </dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {entry.names.map((name) => (
                      <code key={name} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {name}
                      </code>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-muted-foreground">
                    {t("legal.privacy.labels.category")}
                  </dt>
                  <dd className="mt-1">{t(`legal.privacy.entries.${entry.id}.category`)}</dd>
                </div>
                <div>
                  <dt className="font-medium text-muted-foreground">
                    {t("legal.privacy.labels.purpose")}
                  </dt>
                  <dd className="mt-1">{t(`legal.privacy.entries.${entry.id}.purpose`)}</dd>
                </div>
                <div>
                  <dt className="font-medium text-muted-foreground">
                    {t("legal.privacy.labels.retention")}
                  </dt>
                  <dd className="mt-1">{t(`legal.privacy.entries.${entry.id}.retention`)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="analytics-heading">
        <h2 id="analytics-heading" className="text-xl font-semibold tracking-tight">
          {t("legal.privacy.analyticsTitle")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("legal.privacy.analyticsBody")}</p>
      </section>

      <section aria-labelledby="consent-heading">
        <h2 id="consent-heading" className="text-xl font-semibold tracking-tight">
          {t("legal.privacy.consentTitle")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("legal.privacy.consentBody")}</p>
        <p className="mt-3 text-sm text-muted-foreground">{t("legal.privacy.storageLegalBasis")}</p>
      </section>
    </div>
  );
}
