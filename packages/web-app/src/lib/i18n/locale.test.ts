import { describe, expect, it } from "vitest";

import { LOCALE_COOKIE_MAX_AGE_SECONDS, resolveLocale, serializeLocaleCookie } from "./locale";

describe("resolveLocale", () => {
  it("prefers a supported cookie over Accept-Language", () => {
    expect(resolveLocale("de", "en-US,en;q=0.9")).toBe("de");
  });

  it("uses the first supported Accept-Language entry for an unsupported cookie", () => {
    expect(resolveLocale("fr", "fr-CH, de-DE;q=0.9, en;q=0.8")).toBe("de");
  });

  it("falls back to English when neither source is supported", () => {
    expect(resolveLocale("fr", "fr-CH, it;q=0.9")).toBe("en");
  });
});

describe("serializeLocaleCookie", () => {
  it("sets the one-year, site-wide, Lax cookie without Secure on HTTP", () => {
    const cookie = serializeLocaleCookie("de", false);

    expect(cookie).toContain("nf_locale=de");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}`);
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");
  });

  it("adds Secure on HTTPS", () => {
    expect(serializeLocaleCookie("en", true)).toContain("; Secure");
  });
});
