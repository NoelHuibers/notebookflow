import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const graphCanvasSrc = path.resolve(here, "../graph-canvas/src");
const webAppSrc = path.resolve(here, "src");

export default defineConfig({
  // SPA mode: TanStack Start emits a static client app + an index.html shell, so
  // it deploys to Vercel as a static site (no SSR server to wrangle) — the same
  // model as the old Vite SPA, but with the router + route shell. The editor is
  // client-only and landing/legal are trivial, so we don't need SSR yet; the
  // server for BetterAuth (#59) re-enables SSR + sorts the Vercel server deploy.
  // Tailwind, the graph-canvas source alias, the @/ alias, and Vite env all
  // carry over unchanged.
  plugins: [tailwindcss(), tanstackStart({ spa: { enabled: true } }), react()],
  resolve: {
    alias: [
      { find: "@notebookflow/graph-canvas/sync", replacement: `${graphCanvasSrc}/sync/index.ts` },
      { find: "@notebookflow/graph-canvas", replacement: `${graphCanvasSrc}/index.ts` },
      { find: /^@\/(.*)$/, replacement: `${webAppSrc}/$1` },
    ],
  },
  server: { port: 5173, strictPort: false },
});
