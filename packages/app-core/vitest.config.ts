import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // No DOM needed: the package is pure wire types + fetch/WebSocket client
    // logic, and the tests stub both globals.
    environment: "node",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
