// Vercel serverless function bridging TanStack Start's SSR handler.
//
// `pnpm build` (vite build, SSR) emits dist/server/server.js whose default
// export is the TanStack Start server entry — a Web-standard fetch handler
// (server.fetch(Request) -> Response). Vercel invokes this function with the
// Node (req, res) signature, so we adapt: Node IncomingMessage -> Web Request,
// run the handler, then stream the Web Response back onto the Node response.
//
// dist/ is a build artifact (gitignored); it exists when Vercel bundles this
// function, after the build step. We import it dynamically inside the handler
// so a load-time failure surfaces as a readable 500 body rather than an opaque
// FUNCTION_INVOCATION_FAILED. vercel.json rewrites every non-static route here.

import type { IncomingMessage, ServerResponse } from "node:http";

type FetchHandler = { fetch: (request: Request) => Promise<Response> };

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const url = `${proto}://${req.headers.host}${req.url}`;
  const method = req.method ?? "GET";

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.set(key, value);
  }

  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = Buffer.concat(chunks);
  }

  return new Request(url, { method, headers, body });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    // @ts-expect-error built at deploy time; no types for the dist bundle
    const mod = await import("../dist/server/server.js");
    const server = mod.default as FetchHandler;

    const response = await server.fetch(await toWebRequest(req));

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(
      `SSR bridge error:\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
  }
}
