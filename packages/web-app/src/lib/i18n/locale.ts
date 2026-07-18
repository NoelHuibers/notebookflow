export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "nf_locale";
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "de";
}

/**
 * Resolve the active locale: an explicit cookie wins, then the first supported
 * Accept-Language primary subtag, otherwise the default.
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

/** Build the first-party language cookie written after an explicit selection. */
export function serializeLocaleCookie(locale: Locale, secure: boolean): string {
  const attributes = [
    `${LOCALE_COOKIE}=${locale}`,
    "Path=/",
    `Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}
