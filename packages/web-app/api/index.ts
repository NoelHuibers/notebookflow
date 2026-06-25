// Vercel serverless function: the single entry for every route.
//
// /api/* is dispatched to the server handlers via DYNAMIC import (string
// literals, so Vercel's tracer includes them and the heavy auth/db deps load
// only on an actual /api request — never for plain SSR routes). Everything else
// goes to TanStack Start's SSR handler (dist/server/server.js).
//
// The dispatch is inlined here rather than imported from src/server/api because
// a *static* import of a module that itself uses dynamic import() fails to
// resolve inside the Vercel function at runtime (ERR_MODULE_NOT_FOUND), taking
// the whole function down. src/server/api.ts remains the dev-middleware path.
//
// Vercel invokes this with the Node (req, res) signature; we adapt to/from the
// Web Request/Response API via the shared http-bridge. vercel.json rewrites all
// routes here.

import type { IncomingMessage, ServerResponse } from "node:http";

import { sendWebResponse, toWebRequest } from "../src/server/http-bridge";

type FetchHandler = { fetch: (request: Request) => Promise<Response> };

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const request = await toWebRequest(req);
    const { pathname } = new URL(request.url);

    if (pathname.startsWith("/api/auth/")) {
      const { auth } = await import("../src/lib/auth");
      await sendWebResponse(res, await auth.handler(request));
      return;
    }
    if (pathname === "/api/notebooks" || pathname.startsWith("/api/notebooks/")) {
      const { handleNotebooksRequest } = await import("../src/server/notebooks");
      await sendWebResponse(res, await handleNotebooksRequest(request));
      return;
    }
    if (pathname === "/api/provider-key") {
      const { handleProviderKeyRequest } = await import("../src/server/providerKey");
      await sendWebResponse(res, await handleProviderKeyRequest(request));
      return;
    }

    // @ts-expect-error built at deploy time; no types for the dist bundle
    const mod = await import("../dist/server/server.js");
    await sendWebResponse(res, await (mod.default as FetchHandler).fetch(request));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(`SSR bridge error:\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  }
}
