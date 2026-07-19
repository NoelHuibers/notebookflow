/**
 * Device-authorization flow (RFC 8628) against the hosted web app's
 * better-auth endpoints (#88): request a user code, let the user approve in
 * the browser, poll the token endpoint until an access token arrives.
 *
 * Pure protocol module — no JupyterLab imports; `fetch` and the sleep are
 * injectable so tests can drive the polling loop synchronously. All requests
 * go to the CLOUD base URL only; the engine is never involved.
 */

export interface DeviceCodeGrant {
  deviceCode: string;
  userCode: string;
  /** Where the user approves — `verification_uri_complete` when provided. */
  verificationUri: string;
  /** Polling interval in seconds. */
  interval: number;
  /** Grant lifetime in seconds. */
  expiresIn: number;
}

export type DeviceAuthErrorCode = "expired" | "denied" | "protocol";

/** A device flow that ended without a token; hosts map `code` to copy. */
export class DeviceAuthError extends Error {
  readonly code: DeviceAuthErrorCode;

  constructor(code: DeviceAuthErrorCode, detail = "") {
    super(detail === "" ? `device authorization failed: ${code}` : detail);
    this.name = "DeviceAuthError";
    this.code = code;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type SleepLike = (ms: number) => Promise<void>;

const defaultSleep: SleepLike = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const JSON_HEADERS = { "content-type": "application/json" };

export async function requestDeviceCode(
  baseUrl: string,
  clientId: string,
  fetchFn: FetchLike = fetch,
): Promise<DeviceCodeGrant> {
  const res = await fetchFn(`${baseUrl}/api/auth/device/code`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ client_id: clientId }),
  });
  if (!res.ok) {
    throw new DeviceAuthError(
      "protocol",
      `device code request failed with status ${String(res.status)}`,
    );
  }
  const payload: unknown = await res.json();
  const candidate: {
    device_code?: unknown;
    user_code?: unknown;
    verification_uri?: unknown;
    verification_uri_complete?: unknown;
    interval?: unknown;
    expires_in?: unknown;
  } = isRecord(payload) ? payload : {};
  if (typeof candidate.device_code !== "string" || typeof candidate.user_code !== "string") {
    throw new DeviceAuthError("protocol", "device code response was missing device_code/user_code");
  }
  return {
    deviceCode: candidate.device_code,
    userCode: candidate.user_code,
    verificationUri:
      typeof candidate.verification_uri_complete === "string"
        ? candidate.verification_uri_complete
        : typeof candidate.verification_uri === "string"
          ? candidate.verification_uri
          : `${baseUrl}/device`,
    interval:
      typeof candidate.interval === "number" && candidate.interval > 0 ? candidate.interval : 5,
    expiresIn:
      typeof candidate.expires_in === "number" && candidate.expires_in > 0
        ? candidate.expires_in
        : 900,
  };
}

/**
 * Poll the token endpoint until approval. `authorization_pending` keeps
 * polling, `slow_down` backs off by 5s; `expired_token` / `access_denied`
 * (and running out the grant lifetime) reject with a typed DeviceAuthError.
 */
export async function pollDeviceToken(
  baseUrl: string,
  clientId: string,
  grant: DeviceCodeGrant,
  fetchFn: FetchLike = fetch,
  sleep: SleepLike = defaultSleep,
): Promise<string> {
  const deadline = Date.now() + grant.expiresIn * 1000;
  let intervalSeconds = grant.interval;
  while (Date.now() < deadline) {
    await sleep(intervalSeconds * 1000);
    const res = await fetchFn(`${baseUrl}/api/auth/device/token`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: grant.deviceCode,
        client_id: clientId,
      }),
    });
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      // Non-JSON response — fall through to the protocol error below.
    }
    const record: { access_token?: unknown; error?: unknown } = isRecord(payload) ? payload : {};
    const accessToken = record.access_token;
    if (res.ok && typeof accessToken === "string" && accessToken !== "") {
      return accessToken;
    }
    const error = typeof record.error === "string" ? record.error : "";
    if (error === "authorization_pending") {
      continue;
    }
    if (error === "slow_down") {
      intervalSeconds += 5;
      continue;
    }
    if (error === "expired_token") {
      throw new DeviceAuthError("expired");
    }
    if (error === "access_denied") {
      throw new DeviceAuthError("denied");
    }
    throw new DeviceAuthError(
      "protocol",
      `unexpected response from the sign-in endpoint (status ${String(res.status)})`,
    );
  }
  throw new DeviceAuthError("expired");
}
