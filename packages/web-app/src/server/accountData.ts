/**
 * Account data export queries. Kept independent from the singleton database so
 * the complete ownership mapping can be exercised against an in-memory libSQL
 * database in tests.
 */

import { asc, eq, or } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import * as schema from "../lib/db/schema.js";
import type { AccountDataExport } from "../types/account.js";

export async function deleteUserVerificationRecords(
  database: LibSQLDatabase<typeof schema>,
  userId: string,
  email: string,
): Promise<void> {
  await database
    .delete(schema.verification)
    .where(
      or(
        eq(schema.verification.identifier, userId),
        eq(schema.verification.identifier, email),
        eq(schema.verification.value, userId),
        eq(schema.verification.value, email),
      ),
    );
}

export async function collectAccountData(
  database: LibSQLDatabase<typeof schema>,
  userId: string,
  exportedAt = new Date(),
): Promise<AccountDataExport | null> {
  const [owner] = await database
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  if (owner === undefined) return null;

  const [connections, sessions, notebooks, savedKeys] = await Promise.all([
    database
      .select({
        id: schema.account.id,
        accountId: schema.account.accountId,
        providerId: schema.account.providerId,
        scope: schema.account.scope,
        createdAt: schema.account.createdAt,
        updatedAt: schema.account.updatedAt,
      })
      .from(schema.account)
      .where(eq(schema.account.userId, userId))
      .orderBy(asc(schema.account.createdAt)),
    database
      .select({
        id: schema.session.id,
        createdAt: schema.session.createdAt,
        updatedAt: schema.session.updatedAt,
        expiresAt: schema.session.expiresAt,
        ipAddress: schema.session.ipAddress,
        userAgent: schema.session.userAgent,
      })
      .from(schema.session)
      .where(eq(schema.session.userId, userId))
      .orderBy(asc(schema.session.createdAt)),
    database
      .select({
        id: schema.notebook.id,
        name: schema.notebook.name,
        content: schema.notebook.content,
        createdAt: schema.notebook.createdAt,
        updatedAt: schema.notebook.updatedAt,
      })
      .from(schema.notebook)
      .where(eq(schema.notebook.userId, userId))
      .orderBy(asc(schema.notebook.createdAt)),
    database
      .select({
        provider: schema.providerKey.provider,
        model: schema.providerKey.model,
        createdAt: schema.providerKey.createdAt,
        updatedAt: schema.providerKey.updatedAt,
      })
      .from(schema.providerKey)
      .where(eq(schema.providerKey.userId, userId))
      .limit(1),
  ]);

  const savedKey = savedKeys[0];
  return {
    version: 1,
    exportedAt: exportedAt.toISOString(),
    account: {
      id: owner.id,
      name: owner.name,
      email: owner.email,
      emailVerified: owner.emailVerified,
      image: owner.image,
      createdAt: owner.createdAt.toISOString(),
      updatedAt: owner.updatedAt.toISOString(),
    },
    connections: connections.map((connection) => ({
      ...connection,
      createdAt: connection.createdAt.toISOString(),
      updatedAt: connection.updatedAt.toISOString(),
    })),
    sessions: sessions.map((currentSession) => ({
      ...currentSession,
      createdAt: currentSession.createdAt.toISOString(),
      updatedAt: currentSession.updatedAt.toISOString(),
      expiresAt: currentSession.expiresAt.toISOString(),
    })),
    notebooks: notebooks.map((savedNotebook) => ({
      ...savedNotebook,
      createdAt: savedNotebook.createdAt.toISOString(),
      updatedAt: savedNotebook.updatedAt.toISOString(),
    })),
    providerKey:
      savedKey === undefined
        ? null
        : {
            ...savedKey,
            createdAt: savedKey.createdAt.toISOString(),
            updatedAt: savedKey.updatedAt.toISOString(),
            secretIncluded: false,
          },
    excludedSecrets: [
      "OAuth access, refresh, and ID tokens",
      "session tokens",
      "the encrypted provider API-key value",
    ],
  };
}
