// Vercel serverless function: the single entry for every route.
//
// - /api/auth/*  -> BetterAuth handler (lazy import, so SSR-only requests never
//   load the auth DB; if Turso is misconfigured only auth breaks, not the app).
// - everything else -> TanStack Start's SSR handler (dist/server/server.js,
//   produced by `vite build`; its default export is a Web fetch handler).
//
// Vercel invokes this with the Node (req, res) signature, so we adapt to/from
// the Web Request/Response API via the shared http-bridge. vercel.json rewrites
// all routes here.

import type { IncomingMessage, ServerResponse } from "node:http";

import { handleApi } from "../src/server/api";
import { sendWebResponse, toWebRequest } from "../src/server/http-bridge";

type FetchHandler = { fetch: (request: Request) => Promise<Response> };

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const request = await toWebRequest(req);

    const apiResponse = await handleApi(request);
    if (apiResponse) {
      await sendWebResponse(res, apiResponse);
      return;
    }

    // @ts-expect-error built at deploy time; no types for the dist bundle
    const mod = await import("../dist/server/server.js");
    await sendWebResponse(res, await (mod.default as FetchHandler).fetch(request));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(
      `SSR bridge error:\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
  }
}
