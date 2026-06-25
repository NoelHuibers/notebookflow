import { defineConfig } from "drizzle-kit";

// Env is provided by the shell (load .env.local before running drizzle-kit,
// e.g. `set -a; . ./.env.local; set +a; pnpm db:push`).
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? "",
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
