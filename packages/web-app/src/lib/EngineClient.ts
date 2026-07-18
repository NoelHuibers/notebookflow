/**
 * Web-app entry point for the engine client.
 *
 * The client class, the engine wire types, and the pure helpers live in the
 * host-agnostic `@notebookflow/app-core` package; this module re-exports them
 * and layers on the web-app-specific environment defaults (Vite env vars), so
 * every existing `@/lib/EngineClient` import keeps working unchanged.
 */

import { EngineClient as CoreEngineClient } from "@notebookflow/app-core";

export * from "@notebookflow/app-core";

const FALLBACK_ENGINE_URL = "ws://localhost:8765/ws";

/**
 * Resolve the engine WebSocket URL from the env var, falling back to localhost
 * if the value is missing or doesn't look like a WS URL.
 *
 * The validation guards against a common Vercel misconfiguration: pasting the
 * whole `VITE_NOTEBOOKFLOW_ENGINE_URL = ws://…` line into the Value field
 * instead of just the URL. Without this guard, WebSocket would try to connect
 * to the env-var name itself and produce a baffling error.
 */
function resolveEngineUrl(): string {
  const raw = import.meta.env.VITE_NOTEBOOKFLOW_ENGINE_URL as string | undefined;
  if (raw === undefined) {
    return FALLBACK_ENGINE_URL;
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return FALLBACK_ENGINE_URL;
  }
  if (!/^wss?:\/\//.test(trimmed)) {
    console.warn(
      `VITE_NOTEBOOKFLOW_ENGINE_URL is "${trimmed}" — expected ws:// or wss:// URL. ` +
        `Check the Value field in your Vercel env vars: it should be the URL only, ` +
        `not "KEY=VALUE". Falling back to ${FALLBACK_ENGINE_URL}.`,
    );
    return FALLBACK_ENGINE_URL;
  }
  return trimmed;
}

export const DEFAULT_ENGINE_URL = resolveEngineUrl();

/**
 * Optional shared-secret token for engines deployed with
 * NOTEBOOKFLOW_AUTH_TOKEN set. Empty means "auth disabled" -- the client
 * sends no Authorization header and skips the WS token query param.
 */
function resolveEngineToken(): string {
  const raw = import.meta.env.VITE_NOTEBOOKFLOW_ENGINE_TOKEN;
  if (raw === undefined) {
    return "";
  }
  return raw.trim();
}

export const DEFAULT_ENGINE_TOKEN = resolveEngineToken();

/**
 * The app-core EngineClient with web-app defaults: constructed without
 * arguments it targets the env-configured engine URL and self-host token.
 * (Shadows the star re-export above, so `new EngineClient()` keeps its
 * pre-extraction behavior.)
 */
export class EngineClient extends CoreEngineClient {
  constructor(url: string = DEFAULT_ENGINE_URL, token: string = DEFAULT_ENGINE_TOKEN) {
    super(url, token);
  }
}
