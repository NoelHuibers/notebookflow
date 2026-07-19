import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EngineClient } from "./EngineClient";

/**
 * Minimal WebSocket stand-in: records the URL it was opened with and lets the
 * test dispatch server events. `close` is a no-op — by the time the client
 * calls it the run promise has already resolved.
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, callback: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(callback);
    this.listeners.set(type, list);
  }

  send(_data: string): void {}

  close(): void {}

  emit(type: string, event: unknown): void {
    for (const callback of this.listeners.get(type) ?? []) {
      callback(event);
    }
  }
}

/** Run an empty pipeline to completion and return the URL the socket opened. */
async function runAndCaptureWsUrl(client: EngineClient): Promise<string> {
  const done = client.runPipeline({
    pipelineId: "p1",
    pipeline: { nodes: [], edges: [] },
    onEvent: () => {},
  });
  const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
  ws.emit("message", {
    data: JSON.stringify({ type: "pipelineCompleted", pipelineId: "p1", results: [] }),
  });
  await done;
  return ws.url;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EngineClient URLs", () => {
  it("exposes the constructor URL as baseUrl", () => {
    expect(new EngineClient("ws://localhost:8765/ws").baseUrl).toBe("ws://localhost:8765/ws");
  });

  it("derives HTTP webhook URLs from the WS URL, encoding the trigger id", () => {
    const client = new EngineClient("wss://engine.example.com/ws");
    expect(client.webhookUrl("t 1")).toBe("https://engine.example.com/triggers/t%201/fire");
  });

  it("opens the WS without a token query param when no token is set", async () => {
    const client = new EngineClient("ws://localhost:8765/ws");
    expect(await runAndCaptureWsUrl(client)).toBe("ws://localhost:8765/ws");
  });

  it("appends ?token= with URI encoding after setToken", async () => {
    const client = new EngineClient("ws://localhost:8765/ws");
    client.setToken("abc/def");
    expect(await runAndCaptureWsUrl(client)).toBe("ws://localhost:8765/ws?token=abc%2Fdef");
  });

  it("joins the token with & when the base URL already has a query", async () => {
    const client = new EngineClient("ws://localhost:8765/ws?x=1", "tok");
    expect(await runAndCaptureWsUrl(client)).toBe("ws://localhost:8765/ws?x=1&token=tok");
  });
});

describe("EngineClient auth headers", () => {
  it("sends no Authorization header when the token is empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    await new EngineClient("ws://localhost:8765/ws").listDataFiles();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8765/files");
    expect(init.headers).toEqual({});
  });

  it("sends Authorization: Bearer after setToken", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineClient("ws://localhost:8765/ws");
    client.setToken("jwt-123");
    await client.listDataFiles();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({ Authorization: "Bearer jwt-123" });
  });

  it("downloads an encoded data-file path with the bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("a,b\n1,2\n", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineClient("wss://engine.example.com/ws", "jwt-123");

    const blob = await client.downloadDataFile("Q1 sales.csv");

    expect(await blob.text()).toBe("a,b\n1,2\n");
    expect(fetchMock).toHaveBeenCalledWith("https://engine.example.com/files/Q1%20sales.csv", {
      headers: { Authorization: "Bearer jwt-123" },
    });
  });

  it("purges only the authenticated account-data endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineClient("wss://engine.example.com/ws", "jwt-123");

    await client.deleteAccountData();

    expect(fetchMock).toHaveBeenCalledWith("https://engine.example.com/account-data", {
      method: "DELETE",
      headers: { Authorization: "Bearer jwt-123" },
    });
  });
});

describe("EngineClient credentials", () => {
  it("attaches credentials to LLM requests when an API key is set", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ answer: "a", backend: "b", warnings: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineClient("ws://localhost:8765/ws");
    client.setCredentials({ provider: "anthropic", model: "m", apiKey: "sk-1" });
    await client.askLLM("hello");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: "hello",
      credentials: { provider: "anthropic", model: "m", apiKey: "sk-1" },
    });
  });

  it("omits credentials when the API key is empty", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ answer: "a", backend: "b", warnings: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineClient("ws://localhost:8765/ws");
    client.setCredentials({ provider: "anthropic", model: "m", apiKey: "" });
    await client.askLLM("hello");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ prompt: "hello" });
  });
});

describe("EngineClient.ping", () => {
  it("returns true for a healthy engine", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await new EngineClient("ws://localhost:8765/ws").ping()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8765/health");
  });

  it("returns false when the engine is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("refused")));
    expect(await new EngineClient("ws://localhost:8765/ws").ping()).toBe(false);
  });
});
