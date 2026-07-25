import { describe, expect, it } from "vitest";

import { engineTokenRefreshDelayMs, jwtExpiryMs } from "@/lib/engineToken";

// Minimal unsigned JWT with the given claims — only the payload segment is read.
function jwt(claims: Record<string, unknown>): string {
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url({ alg: "none" })}.${b64url(claims)}.`;
}

describe("jwtExpiryMs", () => {
  it("decodes the exp claim to milliseconds", () => {
    expect(jwtExpiryMs(jwt({ sub: "u", exp: 1_700_000_000 }))).toBe(1_700_000_000_000);
  });

  it("handles base64url payloads (- and _)", () => {
    // A payload that base64-encodes with + and / so we exercise the normalisation.
    const token = jwt({ sub: "user??>>", exp: 1_700_000_123 });
    expect(jwtExpiryMs(token)).toBe(1_700_000_123_000);
  });

  it("returns null for a token without exp", () => {
    expect(jwtExpiryMs(jwt({ sub: "u" }))).toBeNull();
  });

  it("returns null for a malformed token", () => {
    expect(jwtExpiryMs("")).toBeNull();
    expect(jwtExpiryMs("not-a-jwt")).toBeNull();
    expect(jwtExpiryMs("a.!!!.c")).toBeNull();
  });
});

describe("engineTokenRefreshDelayMs", () => {
  const now = 1_700_000_000_000;

  it("schedules refresh one minute before expiry", () => {
    const token = jwt({ sub: "u", exp: (now + 15 * 60_000) / 1000 });
    expect(engineTokenRefreshDelayMs(token, now)).toBe(14 * 60_000);
  });

  it("clamps a near-expiry token to the floor instead of a tight loop", () => {
    const token = jwt({ sub: "u", exp: (now + 5_000) / 1000 });
    expect(engineTokenRefreshDelayMs(token, now)).toBe(10_000);
  });

  it("clamps an already-expired token to the floor", () => {
    const token = jwt({ sub: "u", exp: (now - 60_000) / 1000 });
    expect(engineTokenRefreshDelayMs(token, now)).toBe(10_000);
  });

  it("caps an implausibly long-lived token to the max", () => {
    const token = jwt({ sub: "u", exp: (now + 60 * 60_000) / 1000 });
    expect(engineTokenRefreshDelayMs(token, now)).toBe(15 * 60_000);
  });

  it("falls back to the default interval for an unparseable token", () => {
    expect(engineTokenRefreshDelayMs("garbage", now)).toBe(10 * 60_000);
  });
});
