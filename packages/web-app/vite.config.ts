import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const graphCanvasSrc = path.resolve(here, "../graph-canvas/src");
const webAppSrc = path.resolve(here, "src");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@notebookflow/graph-canvas/sync", replacement: `${graphCanvasSrc}/sync/index.ts` },
      { find: "@notebookflow/graph-canvas", replacement: `${graphCanvasSrc}/index.ts` },
      { find: /^@\/(.*)$/, replacement: `${webAppSrc}/$1` },
    ],
  },
  server: { port: 5173, strictPort: false },
});
