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
  // tanstackStart() provides SSR + routing over Vite; viteReact() handles JSX/Fast
  // Refresh. Tailwind, the graph-canvas source alias, the @/ alias, and Vite env
  // (import.meta.env.VITE_*) all carry over from the SPA unchanged.
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
