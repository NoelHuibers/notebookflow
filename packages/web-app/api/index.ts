// Vercel serverless function bridging TanStack Start's SSR handler.
//
// `pnpm build` (vite build, SSR) emits dist/server/server.js whose default
// export is the TanStack Start server entry — a Web-standard fetch handler.
// Vercel's Node runtime supports Web `Request`/`Response` handlers, so we just
// forward to it. dist/ is a build artifact (gitignored); it exists when Vercel
// bundles this function, after the build step. vercel.json rewrites every
// non-static route here.

// @ts-expect-error built at deploy time; no types for the dist bundle
import server from "../dist/server/server.js";

export default function handler(request: Request): Promise<Response> {
  return server.fetch(request);
}
