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
  // SSR mode. The build emits dist/client (static assets) + dist/server/server.js
  // (a Web-fetch handler, default export). TanStack Start v1 has no Vercel preset,
  // so we bridge that handler to a Vercel serverless function in api/ (see
  // api/index.ts + vercel.json). Tailwind, the graph-canvas source alias, the @/
  // alias, and Vite env all carry over unchanged.
  plugins: [tailwindcss(), tanstackStart(), react()],
  resolve: {
    alias: [
      { find: "@notebookflow/graph-canvas/sync", replacement: `${graphCanvasSrc}/sync/index.ts` },
      { find: "@notebookflow/graph-canvas", replacement: `${graphCanvasSrc}/index.ts` },
      { find: /^@\/(.*)$/, replacement: `${webAppSrc}/$1` },
    ],
  },
  server: { port: 5173, strictPort: false },
});
