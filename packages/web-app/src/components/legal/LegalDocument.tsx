import type { ReactElement, ReactNode } from "react";

import { useI18n } from "@/lib/i18n";

export function LegalDocument({ children }: { children: ReactNode }): ReactElement {
  const { t } = useI18n();
  return (
    <div className="mt-5 space-y-9 leading-relaxed">
      <p className="text-sm text-muted-foreground">{t("legal.shared.updated")}</p>
      {children}
      <p className="rounded-md border border-border/70 bg-muted/30 p-4 text-sm text-muted-foreground">
        {t("legal.shared.reviewNotice")}
      </p>
    </div>
  );
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="mt-2 space-y-3 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}
