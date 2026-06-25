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
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins/jwt";

import { db } from "./db";
import * as schema from "./db/schema";

// Destructured (not process.env.X) to satisfy both biome's literal-key rule and
// tsc's noPropertyAccessFromIndexSignature.
const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } =
  process.env;

const socialProviders = {
  ...(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET
    ? { github: { clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET } }
    : {}),
  ...(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
    ? { google: { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET } }
    : {}),
};

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  socialProviders,
  plugins: [jwt()],
});
