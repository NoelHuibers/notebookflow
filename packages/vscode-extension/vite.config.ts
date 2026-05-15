import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const graphCanvasSrc = path.resolve(here, "../graph-canvas/src");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: path.resolve(here, "webview"),
  build: {
    outDir: path.resolve(here, "dist-webview"),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      output: {
        // Predictable filenames so the extension URI-rewrites stay simple.
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  resolve: {
    alias: [
      { find: "@notebookflow/graph-canvas/sync", replacement: `${graphCanvasSrc}/sync/index.ts` },
      { find: "@notebookflow/graph-canvas", replacement: `${graphCanvasSrc}/index.ts` },
    ],
  },
});
