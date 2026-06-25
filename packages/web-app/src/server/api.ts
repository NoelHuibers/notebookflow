/**
 * Single dispatcher for server `/api/*` routes. Mounted by both the Vercel
 * function (api/index.ts, production) and the Vite dev middleware
 * (vite.config.ts, local). Returns a Response for a handled route, or null so
 * the caller falls through to TanStack Start's SSR handler.
 *
 * Handlers are imported lazily so SSR-only requests never load the auth DB.
 */

export async function handleApi(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);

  if (pathname.startsWith("/api/auth/")) {
    const { auth } = await import("../lib/auth");
    return auth.handler(request);
  }

  if (pathname === "/api/notebooks" || pathname.startsWith("/api/notebooks/")) {
    const { handleNotebooksRequest } = await import("./notebooks");
    return handleNotebooksRequest(request);
  }

  if (pathname === "/api/provider-key") {
    const { handleProviderKeyRequest } = await import("./providerKey");
    return handleProviderKeyRequest(request);
  }

  return null;
}
