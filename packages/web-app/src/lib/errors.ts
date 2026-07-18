/**
 * Locale-independent errors for lib code.
 *
 * Lib modules (notebook parsing, the notebooks API client) run outside the
 * React tree — some also on the server — so they must not depend on
 * react-i18next. Instead they throw a `LocalizableError` carrying a message
 * key + params, and the UI turns it into copy via `formatError(t, err)`.
 */

import type { TFunction } from "i18next";

export class LocalizableError extends Error {
  readonly messageKey: string;
  readonly params: Record<string, string | number> | undefined;

  constructor(messageKey: string, params?: Record<string, string | number>) {
    super(messageKey);
    this.name = "LocalizableError";
    this.messageKey = messageKey;
    this.params = params;
  }
}

/**
 * Render any caught value as user-facing copy: `LocalizableError` resolves
 * through the catalog, a plain `Error` keeps its message, anything else falls
 * back to `fallbackKey` (default: the generic unknown-error string).
 */
export function formatError(
  t: TFunction,
  err: unknown,
  fallbackKey = "app.errors.unknown",
): string {
  if (err instanceof LocalizableError) {
    return err.params === undefined ? t(err.messageKey) : t(err.messageKey, err.params);
  }
  if (err instanceof Error) {
    return err.message;
  }
  return t(fallbackKey);
}
