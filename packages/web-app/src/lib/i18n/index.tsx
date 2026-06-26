import { useRouter } from "@tanstack/react-router";
import i18next, { type i18n as I18nInstance } from "i18next";
import type { ReactElement, ReactNode } from "react";
import { useMemo } from "react";
import { I18nextProvider, initReactI18next, useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { de, en } from "./messages";

export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
/** Persisted locale cookie. Lax + long-lived so the SSR request can read it back. */
export const LOCALE_COOKIE = "nf_locale";

const resources = {
  en: { translation: en },
  de: { translation: de },
};

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "de";
}

/**
 * Resolve the active locale: an explicit cookie wins, then the first supported
 * Accept-Language primary subtag, otherwise the default. Pure, so both the SSR
 * request path and the client path call it with the same precedence.
 */
export function resolveLocale(cookieValue?: string | null, acceptLanguage?: string | null): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  if (acceptLanguage) {
    for (const part of acceptLanguage.split(",")) {
      const primary = part.trim().split(";")[0]?.split("-")[0]?.toLowerCase();
      if (isLocale(primary)) return primary;
    }
  }
  return DEFAULT_LOCALE;
}

/**
 * A fresh, fully-initialized i18next instance for one locale. A new instance per
 * request (and per locale on the client) avoids i18next's default singleton being
 * mutated across concurrent SSR renders. `initImmediate: false` forces synchronous
 * init so `t` is ready during the server render — no Suspense / empty first paint.
 */
export function createI18n(locale: Locale): I18nInstance {
  const instance = i18next.createInstance();
  instance.use(initReactI18next).init({
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: LOCALES,
    resources,
    interpolation: { escapeValue: false },
    // Synchronous init (i18next v26 renamed `initImmediate`) so `t` is ready during
    // the SSR render — no Suspense / empty first paint.
    initAsync: false,
    react: { useSuspense: false },
  });
  return instance;
}

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}): ReactElement {
  const instance = useMemo(() => createI18n(locale), [locale]);
  return <I18nextProvider i18n={instance}>{children}</I18nextProvider>;
}

/** Convenience wrapper: react-i18next's `t` plus the resolved locale and Intl formatters. */
export function useI18n() {
  const { t, i18n } = useTranslation();
  const locale: Locale = isLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE;
  return {
    t,
    locale,
    formatDate: (value: number | Date, opts?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale, opts).format(value),
    formatNumber: (value: number, opts?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(locale, opts).format(value),
  };
}

function setLocaleCookie(locale: Locale): void {
  // 1 year, Lax — readable by the SSR request on the next navigation/reload.
  // biome-ignore lint/suspicious/noDocumentCookie: a plain synchronous write is intended here; CookieStore is async and not universally supported.
  document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=31536000;samesite=lax`;
}

/**
 * Compact EN/DE segmented switch. Persists the choice to the cookie, then invalidates
 * the router so the root `beforeLoad` re-resolves the locale (no full reload).
 */
export function LanguageSwitcher({ className }: { className?: string }): ReactElement {
  const { locale } = useI18n();
  const router = useRouter();

  return (
    // biome-ignore lint/a11y/useSemanticElements: a compact EN/DE toggle; a fieldset/legend is heavier than warranted.
    <div
      className={cn("inline-flex items-center rounded-md border border-border p-0.5", className)}
      role="group"
      aria-label="Language"
    >
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === locale}
          onClick={() => {
            if (option === locale) return;
            setLocaleCookie(option);
            void router.invalidate();
          }}
          className={cn(
            "rounded px-2 py-0.5 text-[11px] font-medium uppercase transition-colors",
            option === locale
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
