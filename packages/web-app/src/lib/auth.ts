/**
 * BetterAuth server (#56 decision: BetterAuth + Turso + GitHub/Google + JWT).
 *
 * Server-only. Mounted at /api/auth/* by the Vercel function (api/index.ts) in
 * production and a Vite dev middleware (vite.config.ts) locally. The `jwt`
 * plugin adds a JWKS endpoint (/api/auth/jwks) and mints short-lived JWTs at
 * /api/auth/token; the engine verifies those against the JWKS.
 *
 * Reads BETTER_AUTH_SECRET and BETTER_AUTH_URL from the environment
 * automatically. Social providers are registered only when their credentials
 * are present, so the server boots (and JWKS works) before the GitHub/Google
 * OAuth apps exist.
 */

import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins/jwt";
import { deleteUserVerificationRecords } from "../server/accountData.js";
import { drizzleAdapter } from "./db/drizzle-adapter.js";
import { db } from "./db/index.js";
import * as schema from "./db/schema.js";

// Destructured (not process.env.X) to satisfy both biome's literal-key rule and
// tsc's noPropertyAccessFromIndexSignature.
const {
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  BETTER_AUTH_URL,
  NOTEBOOKFLOW_TRUSTED_ORIGINS,
  NODE_ENV,
} = process.env;

const socialProviders = {
  ...(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET
    ? { github: { clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET } }
    : {}),
  ...(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
    ? { google: { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET } }
    : {}),
};

const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

// Origins allowed to hit state-changing auth routes (#82). BetterAuth already
// trusts the baseURL origin; this adds the deploy URL explicitly plus any
// extra origins (e.g. Vercel previews) via a comma-separated env override.
function trustedOrigins(): string[] {
  const origins: string[] = [];
  if (BETTER_AUTH_URL) {
    try {
      origins.push(new URL(BETTER_AUTH_URL).origin);
    } catch {
      // Malformed BETTER_AUTH_URL — BetterAuth itself will complain about it.
    }
  }
  for (const entry of NOTEBOOKFLOW_TRUSTED_ORIGINS?.split(",") ?? []) {
    const origin = entry.trim();
    if (origin) origins.push(origin);
  }
  return origins;
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  socialProviders,
  plugins: [jwt()],
  trustedOrigins: trustedOrigins(),
  user: {
    // Enables BetterAuth's authenticated deletion endpoint. Deleting the user
    // cascades through sessions, OAuth accounts, notebooks, and the encrypted
    // provider-key row; the browser purges engine uploads immediately before it.
    deleteUser: {
      enabled: true,
      // BetterAuth's verification table has no userId foreign key, so remove
      // any email/user-id verification artifacts explicitly before the user
      // row and all FK-owned rows are cascade-deleted.
      beforeDelete: async (deletingUser) => {
        await deleteUserVerificationRecords(db, deletingUser.id, deletingUser.email);
      },
    },
  },
  // Pin the disclosed seven-day session lifetime instead of inheriting a
  // BetterAuth default that could change during a dependency upgrade.
  session: {
    expiresIn: AUTH_SESSION_MAX_AGE_SECONDS,
  },
  advanced: {
    // Secure cookies in production, plain in local dev (http://localhost).
    useSecureCookies: NODE_ENV === "production",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    },
  },
  rateLimit: {
    // BetterAuth only enables rate limiting in production by default; keep it
    // on everywhere so limits are exercised in dev too.
    enabled: true,
    window: 60,
    max: 30,
    // Vercel functions are ephemeral, so the default in-memory store resets on
    // every cold start. Persist counters in the auth DB (schema.rateLimit).
    storage: "database",
    customRules: {
      // Brute-force surface: OAuth sign-in initiation.
      "/sign-in/*": { window: 60, max: 10 },
      // JWT minting for the engine — called per engine session, keep roomier.
      "/token": { window: 60, max: 30 },
    },
  },
});
