/**
 * Drizzle client over Turso / libSQL. Server-only — never import from a client
 * component (it pulls in @libsql/client and reads secret env vars).
 *
 * Throws on first import if the database isn't configured, so a misconfigured
 * deploy fails loudly at the auth boundary rather than silently. Auth code
 * imports this lazily (only when an /api/auth/* request arrives), so the rest
 * of the app keeps working when the DB is unset.
 */

import { type Config, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

// Destructured (not process.env.X) to satisfy both biome's literal-key rule and
// tsc's noPropertyAccessFromIndexSignature.
const { TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: authToken } = process.env;
if (!url) {
  throw new Error(
    "TURSO_DATABASE_URL is not set — configure the auth database (see .env.example).",
  );
}

const config: Config = authToken ? { url, authToken } : { url };

export const db = drizzle(createClient(config), { schema });
