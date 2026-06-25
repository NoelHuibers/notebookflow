/**
 * Opt-in server-side BYOK provider key (#61). Server-only.
 *
 * One key per user, encrypted at rest (see crypto.ts). The plaintext key is
 * only ever returned to the authenticated owner (so their Settings can load it)
 * and is never logged. Removing it deletes the row.
 */

import { eq } from "drizzle-orm";

import { auth } from "../lib/auth";
import { db } from "../lib/db";
import { providerKey } from "../lib/db/schema";
import { decryptSecret, encryptSecret } from "./crypto";

export interface ProviderKey {
  provider: string;
  model: string;
  apiKey: string;
}

export async function getProviderKey(userId: string): Promise<ProviderKey | null> {
  const [row] = await db.select().from(providerKey).where(eq(providerKey.userId, userId)).limit(1);
  if (!row) return null;
  return { provider: row.provider, model: row.model, apiKey: decryptSecret(row.encryptedKey) };
}

export async function saveProviderKey(userId: string, key: ProviderKey): Promise<void> {
  const now = new Date();
  const encryptedKey = encryptSecret(key.apiKey);
  await db
    .insert(providerKey)
    .values({
      userId,
      provider: key.provider,
      model: key.model,
      encryptedKey,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: providerKey.userId,
      set: { provider: key.provider, model: key.model, encryptedKey, updatedAt: now },
    });
}

export async function deleteProviderKey(userId: string): Promise<void> {
  await db.delete(providerKey).where(eq(providerKey.userId, userId));
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Route an /api/provider-key request. Auth-gated; owner-scoped. */
export async function handleProviderKeyRequest(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json({ error: "unauthorized" }, 401);
  const userId = session.user.id;

  if (request.method === "GET") {
    // Returns the decrypted key to its owner, or null when none is stored.
    return json(await getProviderKey(userId));
  }
  if (request.method === "PUT") {
    let body: Record<string, unknown> | null = null;
    try {
      const parsed = await request.json();
      body =
        typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    const { provider, model, apiKey } = body ?? {};
    if (typeof apiKey !== "string" || apiKey === "") {
      return json({ error: "apiKey is required" }, 400);
    }
    await saveProviderKey(userId, {
      provider: typeof provider === "string" ? provider : "",
      model: typeof model === "string" ? model : "",
      apiKey,
    });
    return json({ ok: true });
  }
  if (request.method === "DELETE") {
    await deleteProviderKey(userId);
    return new Response(null, { status: 204 });
  }
  return json({ error: "method not allowed" }, 405);
}
