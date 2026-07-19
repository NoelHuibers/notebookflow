import { type Client, createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as schema from "../lib/db/schema.js";
import { collectAccountData, deleteUserVerificationRecords } from "./accountData.js";

let client: Client;
let database: LibSQLDatabase<typeof schema>;
const timestamp = new Date("2026-07-19T12:00:00.000Z");

beforeEach(async () => {
  client = createClient({ url: "file::memory:" });
  database = drizzle(client, { schema });
  await client.execute("PRAGMA foreign_keys = ON");
  for (const statement of [
    "CREATE TABLE user (id text PRIMARY KEY NOT NULL, name text NOT NULL, email text NOT NULL UNIQUE, email_verified integer NOT NULL, image text, created_at integer NOT NULL, updated_at integer NOT NULL)",
    "CREATE TABLE account (id text PRIMARY KEY NOT NULL, account_id text NOT NULL, provider_id text NOT NULL, user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE, access_token text, refresh_token text, id_token text, access_token_expires_at integer, refresh_token_expires_at integer, scope text, password text, created_at integer NOT NULL, updated_at integer NOT NULL)",
    "CREATE TABLE session (id text PRIMARY KEY NOT NULL, expires_at integer NOT NULL, token text NOT NULL UNIQUE, created_at integer NOT NULL, updated_at integer NOT NULL, ip_address text, user_agent text, user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE)",
    "CREATE TABLE notebook (id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE, name text NOT NULL, content text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL)",
    "CREATE TABLE provider_key (user_id text PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE, provider text NOT NULL, model text NOT NULL, encrypted_key text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL)",
    "CREATE TABLE verification (id text PRIMARY KEY NOT NULL, identifier text NOT NULL, value text NOT NULL, expires_at integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL)",
  ]) {
    await client.execute(statement);
  }
});

afterEach(() => {
  client.close();
});

async function seedUser(id: string, email: string): Promise<void> {
  await database.insert(schema.user).values({
    id,
    name: id,
    email,
    emailVerified: true,
    image: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database.insert(schema.account).values({
    id: `account-${id}`,
    accountId: `github-${id}`,
    providerId: "github",
    userId: id,
    accessToken: `secret-access-${id}`,
    refreshToken: `secret-refresh-${id}`,
    idToken: `secret-id-${id}`,
    scope: "read:user",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database.insert(schema.session).values({
    id: `session-${id}`,
    token: `secret-session-${id}`,
    userId: id,
    expiresAt: new Date("2026-07-26T12:00:00.000Z"),
    createdAt: timestamp,
    updatedAt: timestamp,
    ipAddress: "127.0.0.1",
    userAgent: "test",
  });
  await database.insert(schema.notebook).values({
    id: `notebook-${id}`,
    userId: id,
    name: `${id}.notebookflow.json`,
    content: `{"owner":"${id}"}`,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database.insert(schema.providerKey).values({
    userId: id,
    provider: "anthropic",
    model: "claude",
    encryptedKey: `encrypted-${id}`,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database.insert(schema.verification).values({
    id: `verification-${id}`,
    identifier: email,
    value: id,
    expiresAt: new Date("2026-07-20T12:00:00.000Z"),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

describe("account ownership data", () => {
  it("exports every portable owner record without credential secrets", async () => {
    await seedUser("user-a", "a@example.com");
    await seedUser("user-b", "b@example.com");

    const result = await collectAccountData(database, "user-a", timestamp);

    expect(result?.account.email).toBe("a@example.com");
    expect(result?.connections).toHaveLength(1);
    expect(result?.sessions).toHaveLength(1);
    expect(result?.notebooks.map(({ content }) => content)).toEqual(['{"owner":"user-a"}']);
    expect(result?.providerKey).toMatchObject({ provider: "anthropic", secretIncluded: false });
    expect(JSON.stringify(result)).not.toContain("secret-");
    expect(JSON.stringify(result)).not.toContain("encrypted-user-a");
  });

  it("cascades account deletion through every per-user table without touching another user", async () => {
    await seedUser("user-a", "a@example.com");
    await seedUser("user-b", "b@example.com");

    await deleteUserVerificationRecords(database, "user-a", "a@example.com");
    await database.delete(schema.user).where(eq(schema.user.id, "user-a"));

    expect(await collectAccountData(database, "user-a", timestamp)).toBeNull();
    expect(
      await database.select().from(schema.account).where(eq(schema.account.userId, "user-a")),
    ).toEqual([]);
    expect(
      await database.select().from(schema.session).where(eq(schema.session.userId, "user-a")),
    ).toEqual([]);
    expect(
      await database.select().from(schema.notebook).where(eq(schema.notebook.userId, "user-a")),
    ).toEqual([]);
    expect(
      await database
        .select()
        .from(schema.providerKey)
        .where(eq(schema.providerKey.userId, "user-a")),
    ).toEqual([]);
    expect(
      await database
        .select()
        .from(schema.verification)
        .where(eq(schema.verification.value, "user-a")),
    ).toEqual([]);
    expect((await collectAccountData(database, "user-b", timestamp))?.account.email).toBe(
      "b@example.com",
    );
    expect(
      await database
        .select()
        .from(schema.verification)
        .where(eq(schema.verification.value, "user-b")),
    ).toHaveLength(1);
  });
});
