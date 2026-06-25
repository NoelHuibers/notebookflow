/**
 * Node ↔ Web request/response adapters. Used by both the Vercel function
 * (api/index.ts, production) and the Vite dev middleware (vite.config.ts) so the
 * BetterAuth + TanStack Start handlers — which speak the Web `Request`/`Response`
 * API — run identically in both environments.
 *
 * Pure conversion; imports nothing server-only.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
  const host = req.headers.host ?? "localhost";
  const url = `${proto}://${host}${req.url ?? "/"}`;
  const method = req.method ?? "GET";

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.set(key, value);
  }

  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    init.body = Buffer.concat(chunks);
  }

  return new Request(url, init);
}

export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  // Set-Cookie must stay split: Headers.forEach folds duplicates into one
  // comma-joined value, which corrupts multiple cookies (auth relies on this).
  const setCookie =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
  });
  if (setCookie.length > 0) res.setHeader("set-cookie", setCookie);

  res.end(Buffer.from(await response.arrayBuffer()));
}
