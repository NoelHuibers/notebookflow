import { describe, expect, it } from "vitest";

import {
  DeviceAuthError,
  type DeviceCodeGrant,
  type FetchLike,
  pollDeviceToken,
  requestDeviceCode,
} from "./deviceAuth";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const noSleep = (): Promise<void> => Promise.resolve();

const grant: DeviceCodeGrant = {
  deviceCode: "dev-123",
  userCode: "ABCD-EFGH",
  verificationUri: "https://notebookflow.app/device?user_code=ABCD-EFGH",
  interval: 5,
  expiresIn: 900,
};

describe("requestDeviceCode", () => {
  it("parses the RFC 8628 response and prefers verification_uri_complete", async () => {
    const calls: { input: string; body: unknown }[] = [];
    const fetchFn: FetchLike = (input, init) => {
      calls.push({ input, body: JSON.parse(String(init?.body)) });
      return Promise.resolve(
        jsonResponse(200, {
          device_code: "dev-123",
          user_code: "ABCD-EFGH",
          verification_uri: "https://notebookflow.app/device",
          verification_uri_complete: "https://notebookflow.app/device?user_code=ABCD-EFGH",
          interval: 7,
          expires_in: 600,
        }),
      );
    };
    const result = await requestDeviceCode(
      "https://notebookflow.app",
      "notebookflow-jupyterlab",
      fetchFn,
    );
    expect(calls[0]?.input).toBe("https://notebookflow.app/api/auth/device/code");
    expect(calls[0]?.body).toEqual({ client_id: "notebookflow-jupyterlab" });
    expect(result).toEqual({
      deviceCode: "dev-123",
      userCode: "ABCD-EFGH",
      verificationUri: "https://notebookflow.app/device?user_code=ABCD-EFGH",
      interval: 7,
      expiresIn: 600,
    });
  });

  it("throws a protocol error on a non-OK response", async () => {
    const fetchFn: FetchLike = () =>
      Promise.resolve(jsonResponse(400, { error: "invalid_client" }));
    await expect(requestDeviceCode("https://x", "bad", fetchFn)).rejects.toMatchObject({
      name: "DeviceAuthError",
      code: "protocol",
    });
  });
});

describe("pollDeviceToken", () => {
  it("keeps polling through authorization_pending and resolves with the token", async () => {
    const responses = [
      jsonResponse(400, { error: "authorization_pending" }),
      jsonResponse(400, { error: "authorization_pending" }),
      jsonResponse(200, { access_token: "tok-999" }),
    ];
    let call = 0;
    const fetchFn: FetchLike = (input, init) => {
      expect(input).toBe("https://x/api/auth/device/token");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toEqual({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: "dev-123",
        client_id: "notebookflow-jupyterlab",
      });
      const res = responses[call];
      call += 1;
      if (res === undefined) {
        throw new Error("unexpected extra poll");
      }
      return Promise.resolve(res);
    };
    const token = await pollDeviceToken(
      "https://x",
      "notebookflow-jupyterlab",
      grant,
      fetchFn,
      noSleep,
    );
    expect(token).toBe("tok-999");
    expect(call).toBe(3);
  });

  it("backs off by 5 seconds on slow_down", async () => {
    const sleeps: number[] = [];
    const responses = [
      jsonResponse(400, { error: "slow_down" }),
      jsonResponse(400, { error: "authorization_pending" }),
      jsonResponse(200, { access_token: "tok" }),
    ];
    let call = 0;
    const fetchFn: FetchLike = () => {
      const res = responses[call];
      call += 1;
      if (res === undefined) {
        throw new Error("unexpected extra poll");
      }
      return Promise.resolve(res);
    };
    const sleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    await pollDeviceToken("https://x", "cid", grant, fetchFn, sleep);
    expect(sleeps).toEqual([5000, 10000, 10000]);
  });

  it("rejects with a typed error on expired_token and access_denied", async () => {
    const expired: FetchLike = () => Promise.resolve(jsonResponse(400, { error: "expired_token" }));
    await expect(
      pollDeviceToken("https://x", "cid", grant, expired, noSleep),
    ).rejects.toMatchObject({ code: "expired" });
    const denied: FetchLike = () => Promise.resolve(jsonResponse(400, { error: "access_denied" }));
    await expect(pollDeviceToken("https://x", "cid", grant, denied, noSleep)).rejects.toMatchObject(
      {
        code: "denied",
      },
    );
  });

  it("rejects with a protocol error on an unexpected response", async () => {
    const fetchFn: FetchLike = () => Promise.resolve(new Response("nope", { status: 500 }));
    const err = await pollDeviceToken("https://x", "cid", grant, fetchFn, noSleep).catch(
      (reason: unknown) => reason,
    );
    expect(err).toBeInstanceOf(DeviceAuthError);
    expect((err as DeviceAuthError).code).toBe("protocol");
  });

  it("rejects as expired once the grant lifetime runs out", async () => {
    const shortGrant: DeviceCodeGrant = { ...grant, expiresIn: 0 };
    const fetchFn: FetchLike = () => {
      throw new Error("must not poll after expiry");
    };
    await expect(
      pollDeviceToken("https://x", "cid", shortGrant, fetchFn, noSleep),
    ).rejects.toMatchObject({ code: "expired" });
  });
});
