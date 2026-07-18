import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

import { sendWebResponse, toWebRequest } from "./src/server/http-bridge";

const here = path.dirname(fileURLToPath(import.meta.url));
const graphCanvasSrc = path.resolve(here, "../graph-canvas/src");
const webAppSrc = path.resolve(here, "src");

// In production the Vercel function (api/index.ts) serves /api/* via handleApi.
// `vite dev` has no such function, so mount the same dispatcher as dev
// middleware for parity — lazily loaded (server-only) so the auth/notebooks DB
// is touched only when an /api/* request arrives. enforce:"pre" runs it before
// TanStack Start's SSR catch-all.
function serverApiDevPlugin(): Plugin {
  return {
    name: "notebookflow:server-api-dev",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) {
          next();
          return;
        }
        (async () => {
          const mod = (await server.ssrLoadModule("/src/server/api.ts")) as {
            handleApi: (request: Request) => Promise<Response | null>;
          };
          const response = await mod.handleApi(await toWebRequest(req));
          if (response) {
            await sendWebResponse(res, response);
            return;
          }
          next();
        })().catch(next);
      });
    },
  };
}

// In production Vercel applies the `headers` block from vercel.json to every
// response. Mirror those exact headers in dev (read from the same file, so the
// two can't drift) so CSP breakage surfaces during development instead of only
// after deploy.
function securityHeadersDevPlugin(): Plugin {
  const { headers = [] } = JSON.parse(readFileSync(path.resolve(here, "vercel.json"), "utf8")) as {
    headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  const pairs = headers.flatMap((entry) => entry.headers);
  return {
    name: "notebookflow:security-headers-dev",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        for (const { key, value } of pairs) res.setHeader(key, value);
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Expose all env (incl. server-only secrets like TURSO_*/BETTER_AUTH_*) to the
  // dev process so the auth handler can read them. This does NOT leak to the
  // client bundle — only VITE_-prefixed vars reach import.meta.env.
  const env = loadEnv(mode, here, "");
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return {
    // SSR mode. The build emits dist/client (static assets) + dist/server/server.js
    // (a Web-fetch handler, default export). TanStack Start v1 has no Vercel preset,
    // so we bridge that handler to a Vercel serverless function in api/ (see
    // api/index.ts + vercel.json). Tailwind, the graph-canvas source alias, the @/
    // alias, and Vite env all carry over unchanged.
    plugins: [
      securityHeadersDevPlugin(),
      serverApiDevPlugin(),
      tailwindcss(),
      tanstackStart(),
      react(),
    ],
    resolve: {
      alias: [
        { find: "@notebookflow/graph-canvas/sync", replacement: `${graphCanvasSrc}/sync/index.ts` },
        { find: "@notebookflow/graph-canvas", replacement: `${graphCanvasSrc}/index.ts` },
        { find: /^@\/(.*)$/, replacement: `${webAppSrc}/$1` },
      ],
    },
    server: { port: 5173, strictPort: false },
    // Load the auth server deps as native node modules instead of running them
    // through Vite's SSR transform — they're heavy (and use native libSQL), and
    // transforming them makes the dev /api/auth/* handler hang.
    ssr: { external: ["better-auth", "drizzle-orm", "@libsql/client"] },
  };
});
