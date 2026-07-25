/**
 * Scheduling helper for the short-lived engine JWT (#59).
 *
 * BetterAuth's `jwt` plugin mints tokens that expire (~15 min by default), so
 * the web-app must re-mint before expiry or every `require_auth` engine call —
 * Run, triggers, cloud sync — starts answering 401 once the first token goes
 * stale. `engineTokenRefreshDelayMs` reads the JWT's `exp` claim and returns
 * how long to wait before re-fetching, leaving a safety margin so the new token
 * lands before the old one dies.
 */

// Re-mint this many ms before the token's `exp`, absorbing clock skew and the
// round-trip to /api/auth/token.
const REFRESH_MARGIN_MS = 60_000;

// Never schedule further out than this even if the token claims a long life, and
// never sooner than the floor (a token already near/at expiry still gets one
// prompt refresh rather than a tight loop). Bounds also cover an unparseable
// token, where we fall back to the default.
const MIN_DELAY_MS = 10_000;
const MAX_DELAY_MS = 15 * 60_000;
const DEFAULT_DELAY_MS = 10 * 60_000;

/** Decode a JWT's `exp` (seconds since epoch), or null if it can't be read. */
export function jwtExpiryMs(token: string): number | null {
  const payload = token.split(".")[1];
  if (payload === undefined || payload === "") return null;
  try {
    // JWT uses base64url; normalise to base64 before decoding.
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64);
    const claims = JSON.parse(json) as { exp?: unknown };
    if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) return null;
    return claims.exp * 1000;
  } catch {
    return null;
  }
}

/**
 * How long (ms) to wait before re-minting `token`, given the current time in ms.
 * Falls back to a fixed interval for a token whose `exp` can't be read, and
 * clamps to [MIN, MAX] so a malformed or already-expired token can neither
 * strand the session nor busy-loop.
 */
export function engineTokenRefreshDelayMs(token: string, nowMs: number): number {
  const expiry = jwtExpiryMs(token);
  if (expiry === null) return DEFAULT_DELAY_MS;
  const delay = expiry - nowMs - REFRESH_MARGIN_MS;
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, delay));
}
