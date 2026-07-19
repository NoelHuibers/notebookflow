/**
 * Engine URL resolution for the JupyterLab surface.
 *
 * The shared app-core EngineClient is host-agnostic and requires a URL; this
 * module supplies the JupyterLab-specific default (the engine reached through
 * jupyter-server-proxy at the page's Jupyter base URL) and honours the
 * `engineUrlOverride` plugin setting when the user points at an engine
 * directly.
 */

const FALLBACK_ENGINE_URL = "ws://127.0.0.1:8765/ws";
const PROXY_PORT = 8765;

/**
 * Build the engine WebSocket URL that runs through jupyter-server-proxy when
 * we're inside a JupyterLab page. Strips the trailing /lab[...] from the
 * current pathname so the proxy is rooted at the Jupyter base URL -- works
 * for vanilla `localhost:8888/lab` and for JupyterHub paths like
 * `localhost:8888/user/me/lab`.
 *
 * Falls back to the loopback URL for tests + non-browser hosts.
 */
export function resolveDefaultEngineUrl(): string {
  if (typeof window === "undefined" || typeof window.location === "undefined") {
    return FALLBACK_ENGINE_URL;
  }
  const loc = window.location;
  if (loc.host === "" || loc.protocol === "file:") {
    return FALLBACK_ENGINE_URL;
  }
  const wsProto = loc.protocol === "https:" ? "wss" : "ws";
  const trimmedPath = (loc.pathname || "/").replace(/\/+$/, "");
  const baseRoot = trimmedPath.replace(/\/lab(\/.*)?$/, "") || "";
  return `${wsProto}://${loc.host}${baseRoot}/proxy/${String(PROXY_PORT)}/ws`;
}

/**
 * Resolve the engine WS URL, honouring a non-empty `engineUrlOverride`
 * setting. Overrides given as http(s) URLs are converted to ws(s) since the
 * EngineClient expects the WebSocket endpoint and derives REST URLs from it.
 */
export function resolveEngineUrl(override: string): string {
  const trimmed = override.trim();
  if (trimmed === "") {
    return resolveDefaultEngineUrl();
  }
  return trimmed.replace(/^http/, "ws");
}
