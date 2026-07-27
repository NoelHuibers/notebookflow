import { fileURLToPath } from "node:url";

/**
 * Dedicated Vitest config for Benchmark 1. Kept separate from the graph-canvas
 * package's vitest.config.ts (which only includes src/**\/*.test.ts) so the
 * benchmark is NEVER collected by `pnpm test` / CI — it only runs when this
 * config is passed explicitly (see bench/README.md).
 *
 * Exported as a plain object (not via `defineConfig`) so this file has no
 * imports to resolve from bench/, which is not an npm package. Run it with the
 * graph-canvas package's vitest binary, which resolves the source + deps.
 */
export default {
  // Root at the repo top so the bench file (outside packages/) is discoverable.
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    environment: "node",
    globals: false,
    include: ["bench/**/*.bench.ts"],
    // A full sweep to 3200 cells with warmups + 9 reps can take a while.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // Single-threaded: no worker-pool overhead, cleaner timing.
    pool: "threads",
    isolate: false,
    fileParallelism: false,
  },
};
