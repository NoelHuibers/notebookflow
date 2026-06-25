/**
 * Per-user notebook persistence (#60). Server-only.
 *
 * Store functions are all scoped by `userId` — there is no code path that
 * reads or writes another user's rows, so cross-user access is impossible
 * (AC: "No user can read or modify another user's notebooks"). The HTTP
 * handler resolves the user from the BetterAuth session and 401s otherwise.
 */

import { and, desc, eq } from "drizzle-orm";

import { auth } from "../lib/auth.js";
import { db } from "../lib/db/index.js";
import { notebook } from "../lib/db/schema.js";

export interface NotebookSummary {
  id: string;
  name: string;
  updatedAt: number;
}

export interface NotebookRecord extends NotebookSummary {
  content: string;
}

export async function listNotebooks(userId: string): Promise<NotebookSummary[]> {
  const rows = await db
    .select({ id: notebook.id, name: notebook.name, updatedAt: notebook.updatedAt })
    .from(notebook)
    .where(eq(notebook.userId, userId))
    .orderBy(desc(notebook.updatedAt));
  return rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt.getTime() }));
}

export async function createNotebook(
  userId: string,
  name: string,
  content: string,
): Promise<NotebookSummary> {
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(notebook).values({ id, userId, name, content, createdAt: now, updatedAt: now });
  return { id, name, updatedAt: now.getTime() };
}

export async function getNotebook(userId: string, id: string): Promise<NotebookRecord | null> {
  const [row] = await db
    .select()
    .from(notebook)
    .where(and(eq(notebook.id, id), eq(notebook.userId, userId)))
    .limit(1);
  if (!row) return null;
  return { id: row.id, name: row.name, content: row.content, updatedAt: row.updatedAt.getTime() };
}

export async function updateNotebook(
  userId: string,
  id: string,
  patch: { name?: string; content?: string },
): Promise<NotebookSummary | null> {
  const set: { name?: string; content?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.content !== undefined) set.content = patch.content;
  const [row] = await db
    .update(notebook)
    .set(set)
    .where(and(eq(notebook.id, id), eq(notebook.userId, userId)))
    .returning({ id: notebook.id, name: notebook.name, updatedAt: notebook.updatedAt });
  if (!row) return null;
  return { id: row.id, name: row.name, updatedAt: row.updatedAt.getTime() };
}

export async function deleteNotebook(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(notebook)
    .where(and(eq(notebook.id, id), eq(notebook.userId, userId)))
    .returning({ id: notebook.id });
  return rows.length > 0;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Route an /api/notebooks[/:id] request. Auth-gated by the BetterAuth session. */
export async function handleNotebooksRequest(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json({ error: "unauthorized" }, 401);
  const userId = session.user.id;

  const { pathname } = new URL(request.url);
  const rest = pathname.slice("/api/notebooks".length);
  const id = rest.startsWith("/") ? decodeURIComponent(rest.slice(1)) : "";

  if (id === "") {
    if (request.method === "GET") return json(await listNotebooks(userId));
    if (request.method === "POST") {
      const body = await readJson(request);
      // Destructured (not body.name) to satisfy biome + tsc index-signature rules.
      const { name, content } = body ?? {};
      if (typeof name !== "string" || typeof content !== "string") {
        return json({ error: "name and content are required" }, 400);
      }
      return json(await createNotebook(userId, name, content), 201);
    }
    return json({ error: "method not allowed" }, 405);
  }

  if (request.method === "GET") {
    const record = await getNotebook(userId, id);
    return record ? json(record) : json({ error: "not found" }, 404);
  }
  if (request.method === "PUT") {
    const body = await readJson(request);
    if (!body) return json({ error: "invalid body" }, 400);
    const { name, content } = body;
    const patch: { name?: string; content?: string } = {};
    if (typeof name === "string") patch.name = name;
    if (typeof content === "string") patch.content = content;
    const record = await updateNotebook(userId, id, patch);
    return record ? json(record) : json({ error: "not found" }, 404);
  }
  if (request.method === "DELETE") {
    return (await deleteNotebook(userId, id))
      ? new Response(null, { status: 204 })
      : json({ error: "not found" }, 404);
  }
  return json({ error: "method not allowed" }, 405);
}
