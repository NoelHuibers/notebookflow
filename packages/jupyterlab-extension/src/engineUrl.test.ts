import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveDefaultEngineUrl, resolveEngineUrl } from "./engineUrl";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveDefaultEngineUrl", () => {
  it("uses the named proxy route for local JupyterLab", () => {
    vi.stubGlobal("window", {
      location: {
        host: "localhost:8888",
        pathname: "/lab",
        protocol: "http:",
      },
    });

    expect(resolveDefaultEngineUrl()).toBe("ws://localhost:8888/notebookflow/ws");
  });

  it("preserves a JupyterHub base path and secure transport", () => {
    vi.stubGlobal("window", {
      location: {
        host: "hub.example.test",
        pathname: "/user/noel/lab/tree/example.ipynb",
        protocol: "https:",
      },
    });

    expect(resolveDefaultEngineUrl()).toBe("wss://hub.example.test/user/noel/notebookflow/ws");
  });
});

describe("resolveEngineUrl", () => {
  it("uses and normalizes an explicit override", () => {
    expect(resolveEngineUrl(" https://engine.example.test/ws ")).toBe(
      "wss://engine.example.test/ws",
    );
  });
});
