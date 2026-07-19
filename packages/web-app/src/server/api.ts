/**
 * Single dispatcher for server `/api/*` routes. Mounted by both the Vercel
 * function (api/index.ts, production) and the Vite dev middleware
 * (vite.config.ts, local). Returns a Response for a handled route, or null so
 * the caller falls through to TanStack Start's SSR handler.
 *
 * Handlers are imported lazily so SSR-only requests never load the auth DB.
 *
 * NOTE: the CORS helpers below are duplicated in api/index.ts (which must not
 * import ../src — see the comment there). Keep both copies in sync.
 */

// Routes the extensions (VS Code / JupyterLab, #88) call cross-origin with a
// bearer token: device-authorization endpoints, notebooks, provider key.
const CORS_API_PREFIXES = ["/api/notebooks", "/api/provider-key", "/api/auth/device"];

function isCorsApiPath(pathname: string): boolean {
  return CORS_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Answer a CORS preflight for the extension-facing API routes, or null when
 * the request is not such a preflight. `Access-Control-Allow-Credentials` is
 * NEVER set: extensions authenticate with `Authorization: Bearer` only, so
 * cookies are never sent cross-origin and cookie-authenticated (same-origin)
 * responses are never exposed to another origin.
 */
export function corsPreflight(request: Request, pathname: string): Response | null {
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

/**
 * Reflect the caller's origin on actual responses of the extension-facing API
 * routes (bearer-only; see corsPreflight). No-op for every other path, so
 * cookie-based browser flows are unaffected.
 */
export function withCors(response: Response, request: Request, pathname: string): Response {
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

export async function handleApi(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);

  const preflight = corsPreflight(request, pathname);
  if (preflight) return preflight;

  if (pathname.startsWith("/api/auth/")) {
    const { auth } = await import("../lib/auth.js");
    return withCors(await auth.handler(request), request, pathname);
  }

  if (pathname === "/api/notebooks" || pathname.startsWith("/api/notebooks/")) {
    const { handleNotebooksRequest } = await import("./notebooks.js");
    return withCors(await handleNotebooksRequest(request), request, pathname);
  }

  if (pathname === "/api/provider-key") {
    const { handleProviderKeyRequest } = await import("./providerKey.js");
    return withCors(await handleProviderKeyRequest(request), request, pathname);
  }

  if (pathname === "/api/account/export") {
    const { handleAccountRequest } = await import("./account.js");
    return handleAccountRequest(request);
  }

  return null;
}
