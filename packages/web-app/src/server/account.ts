/** Authenticated GDPR account-data export endpoint (#79). */

import { auth } from "../lib/auth.js";
import { db } from "../lib/db/index.js";
import { collectAccountData } from "./accountData.js";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
    },
  });
}

export async function handleAccountRequest(request: Request): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json({ error: "unauthorized" }, 401);

  const accountData = await collectAccountData(db, session.user.id);
  return accountData === null ? json({ error: "not found" }, 404) : json(accountData);
}
