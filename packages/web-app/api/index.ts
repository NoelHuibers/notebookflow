// Vercel serverless function: the single entry for every route.
//
// SELF-CONTAINED ON PURPOSE: this file has NO static `../src/*` imports. Once
// the function's module graph includes native deps (@libsql/client via the
// dynamic auth/db imports), Vercel's bundler stops inlining our source files
// and a static `import ... from "../src/..."` fails to resolve at runtime
// (ERR_MODULE_NOT_FOUND), crashing every route. So the Node<->Web bridge is
// inlined here, and the /api handlers load via dynamic, string-literal imports
// (traced by Vercel, resolved at runtime) only when an /api request arrives.
// src/server/http-bridge.ts + src/server/api.ts remain for the Vite dev path.

/// <reference path="./dist-server.d.ts" />
import type { IncomingMessage, ServerResponse } from "node:http";

type FetchHandler = { fetch: (request: Request) => Promise<Response> };

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
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

// Security headers (HSTS, CSP, X-Frame-Options, ...) are NOT set here: the
// source of truth is the `headers` block in vercel.json, which Vercel applies
// to every response of this function (the `/(.*)` rewrite routes everything
// through it). Rationale for the non-obvious CSP bits:
//   - script-src 'unsafe-inline': TanStack Start's <Scripts/> injects an inline
//     hydration script and there is no nonce plumbing yet (nonce-based CSP is a
//     tracked follow-up).
//   - connect-src allows https:/wss: broadly plus localhost http/ws because the
//     engine URL is user-configurable (BYO-engine Settings override).
// Dev parity: vite.config.ts reads the same vercel.json block and applies it
// as middleware.
// CORS for the extension-facing API routes (VS Code / JupyterLab, #88).
// Duplicated from src/server/api.ts (this file must not import ../src — see
// the header comment). Keep both copies in sync.
// `Access-Control-Allow-Credentials` is NEVER set: extensions authenticate
// with `Authorization: Bearer` only, so cookies are never sent cross-origin
// and cookie-authenticated (same-origin) responses are never exposed to
// another origin. Non-matching paths are untouched, so browser cookie flows
// are unaffected.
const CORS_API_PREFIXES = ["/api/notebooks", "/api/provider-key", "/api/auth/device"];

function isCorsApiPath(pathname: string): boolean {
  return CORS_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function corsPreflight(request: Request, pathname: string): Response | null {
  if (request.method !== "OPTIONS" || !isCorsApiPath(pathname)) return null;
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": request.headers.get("origin") ?? "*",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
      "access-control-allow-headers": "Authorization, Content-Type",
      "access-control-max-age": "86400",
      vary: "Origin",
    },
  });
}

function withCors(response: Response, request: Request, pathname: string): Response {
  if (!isCorsApiPath(pathname)) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", request.headers.get("origin") ?? "*");
  headers.append("vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  const setCookie =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
  });
  if (setCookie.length > 0) res.setHeader("set-cookie", setCookie);
  res.end(Buffer.from(await response.arrayBuffer()));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const request = await toWebRequest(req);
    const { pathname } = new URL(request.url);

    const preflight = corsPreflight(request, pathname);
    if (preflight) {
      await sendWebResponse(res, preflight);
      return;
    }

    if (pathname.startsWith("/api/auth/")) {
      const { auth } = await import("../src/lib/auth.js");
      await sendWebResponse(res, withCors(await auth.handler(request), request, pathname));
      return;
    }
    if (pathname === "/api/notebooks" || pathname.startsWith("/api/notebooks/")) {
      const { handleNotebooksRequest } = await import("../src/server/notebooks.js");
      await sendWebResponse(
        res,
        withCors(await handleNotebooksRequest(request), request, pathname),
      );
      return;
    }
    if (pathname === "/api/provider-key") {
      const { handleProviderKeyRequest } = await import("../src/server/providerKey.js");
      await sendWebResponse(
        res,
        withCors(await handleProviderKeyRequest(request), request, pathname),
      );
      return;
    }
    if (pathname === "/api/account/export") {
      const { handleAccountRequest } = await import("../src/server/account.js");
      await sendWebResponse(res, await handleAccountRequest(request));
      return;
    }

    // Typed via api/dist-server.d.ts (referenced above).
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
