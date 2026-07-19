import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CloudClient, CloudRequestError } from "./CloudClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]!;
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

describe("CloudClient", () => {
  it("hits base + /api/notebooks and returns the summaries", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: "n1", name: "a", updatedAt: 1 }]));
    const client = new CloudClient("https://cloud.example", "tok-1");
    const list = await client.listNotebooks();
    expect(list).toEqual([{ id: "n1", name: "a", updatedAt: 1 }]);
    const { url, init } = lastCall();
    expect(url).toBe("https://cloud.example/api/notebooks");
    // Destructured to satisfy both biome's literal-key rule and tsc's
    // noPropertyAccessFromIndexSignature.
    const { Authorization: authHeader } = init.headers as Record<string, string>;
    expect(authHeader).toBe("Bearer tok-1");
    expect(init.credentials).toBeUndefined();
  });

  it("normalizes a trailing slash in the base URL", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await new CloudClient("https://cloud.example/").listNotebooks();
    expect(lastCall().url).toBe("https://cloud.example/api/notebooks");
  });

  it("omits the Authorization header when the token is empty", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await new CloudClient("https://cloud.example").listNotebooks();
    expect(lastCall().init.headers).not.toHaveProperty("Authorization");
  });

  it("setToken affects subsequent requests", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse([])));
    const client = new CloudClient("https://cloud.example");
    await client.listNotebooks();
    client.setToken("tok-2");
    await client.listNotebooks();
    const { Authorization: authHeader } = lastCall().init.headers as Record<string, string>;
    expect(authHeader).toBe("Bearer tok-2");
  });

  it("applies cookie mode (credentials) to fetches", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await new CloudClient("", "", { credentials: "include" }).listNotebooks();
    const { url, init } = lastCall();
    expect(url).toBe("/api/notebooks");
    expect(init.credentials).toBe("include");
  });

  it("URL-encodes notebook ids and sends JSON bodies", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "a/b", name: "n", updatedAt: 2 }));
    const client = new CloudClient("https://cloud.example");
    await client.updateNotebook("a/b", { name: "n" });
    const { url, init } = lastCall();
    expect(url).toBe("https://cloud.example/api/notebooks/a%2Fb");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify({ name: "n" }));
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("throws CloudRequestError with the HTTP status on failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401));
    const client = new CloudClient("https://cloud.example");
    let thrown: unknown;
    try {
      await client.getNotebook("n1");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CloudRequestError);
    expect((thrown as CloudRequestError).status).toBe(401);
  });

  it("round-trips the provider key endpoints", async () => {
    const key = { provider: "anthropic", model: "claude-sonnet-4-5", apiKey: "sk-x" };
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    fetchMock.mockResolvedValueOnce(jsonResponse(key));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const client = new CloudClient("https://cloud.example", "tok");
    await client.saveProviderKey(key);
    expect(lastCall().url).toBe("https://cloud.example/api/provider-key");
    expect(lastCall().init.method).toBe("PUT");

    expect(await client.getProviderKey()).toEqual(key);
    await client.deleteProviderKey();
    expect(lastCall().init.method).toBe("DELETE");
  });
});
