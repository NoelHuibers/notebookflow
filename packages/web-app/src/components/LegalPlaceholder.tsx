import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { Wordmark } from "@/components/Logo";
import { LanguageSwitcher, useI18n } from "@/lib/i18n";

export type LegalPage = "impressum" | "datenschutz" | "agb";

// Shared shell for the legal pages. The heading is localized (DE/EN); the real
// bilingual body content + operator details land in #76.
export function LegalPlaceholder({ page }: { page: LegalPage }): ReactElement {
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-background font-sans text-foreground antialiased">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3.5">
          <Link to="/" className="transition-opacity hover:opacity-80">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link
              to="/"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("common.back")}
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-2xl font-bold tracking-tight">{t(`legal.${page}`)}</h1>
        <p className="mt-4 leading-relaxed text-muted-foreground">{t("legal.placeholder")}</p>
      </main>
    </div>
  );
}
