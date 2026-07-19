/**
 * CloudClient — HTTP client for the NotebookFlow cloud API (the web app's
 * Vercel `/api` routes): per-user notebook persistence (#60) and the opt-in
 * server-side BYOK provider key (#61). This client talks to the cloud API
 * ONLY — the engine has its own client (EngineClient) and its own URL/token
 * plumbing; none of that belongs here.
 *
 * Host-agnostic: the base URL and bearer token are injected by the host.
 * - Extensions (VS Code / JupyterLab, #88): absolute base URL + the device
 *   authorization flow's bearer token, sent as `Authorization: Bearer`.
 * - Web app: empty base URL (same-origin) + `credentials: "include"` so the
 *   session cookie authenticates instead of a token.
 */

export interface NotebookSummary {
  id: string;
  name: string;
  updatedAt: number;
}

export interface NotebookRecord extends NotebookSummary {
  content: string;
}

export interface ProviderKey {
  provider: string;
  model: string;
  apiKey: string;
}

export interface CloudClientOptions {
  /**
   * Forwarded to every fetch. The web app passes `"include"` for cookie
   * (session) auth; extensions omit it and authenticate via bearer token.
   */
  credentials?: RequestCredentials;
}

/** A cloud API request that came back non-OK; `status` is the HTTP status. */
export class CloudRequestError extends Error {
  readonly status: number;

  constructor(operation: string, status: number) {
    super(`CloudClient.${operation}: request failed with status ${String(status)}`);
    this.name = "CloudRequestError";
    this.status = status;
  }
}

export class CloudClient {
  private readonly baseUrl: string;
  private token: string;
  private readonly credentials: RequestCredentials | undefined;

  constructor(baseUrl: string, token = "", opts: CloudClientOptions = {}) {
    // Normalized so `${base}/api/...` never doubles the slash.
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
    this.credentials = opts.credentials;
  }

  /**
   * Set (or clear, with "") the bearer token sent as `Authorization`.
   * Affects requests made after the call.
   */
  setToken(token: string): void {
    this.token = token;
  }

  private authHeaders(): Record<string, string> {
    return this.token === "" ? {} : { Authorization: `Bearer ${this.token}` };
  }

  private async request(
    operation: string,
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      ...(this.credentials === undefined ? {} : { credentials: this.credentials }),
      headers: { ...this.authHeaders(), ...init.headers },
    });
    if (!res.ok) {
      throw new CloudRequestError(operation, res.status);
    }
    return res;
  }

  // ---------------------------------------------------------------------
  // Notebooks (#60) — the user's saved workspace documents.
  // ---------------------------------------------------------------------

  async listNotebooks(): Promise<NotebookSummary[]> {
    const res = await this.request("listNotebooks", "/api/notebooks");
    return (await res.json()) as NotebookSummary[];
  }

  async getNotebook(id: string): Promise<NotebookRecord> {
    const res = await this.request("getNotebook", `/api/notebooks/${encodeURIComponent(id)}`);
    return (await res.json()) as NotebookRecord;
  }

  async createNotebook(name: string, content: string): Promise<NotebookSummary> {
    const res = await this.request("createNotebook", "/api/notebooks", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name, content }),
    });
    return (await res.json()) as NotebookSummary;
  }

  async updateNotebook(
    id: string,
    patch: { name?: string; content?: string },
  ): Promise<NotebookSummary> {
    const res = await this.request("updateNotebook", `/api/notebooks/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(patch),
    });
    return (await res.json()) as NotebookSummary;
  }

  async deleteNotebook(id: string): Promise<void> {
    await this.request("deleteNotebook", `/api/notebooks/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  // ---------------------------------------------------------------------
  // Provider key (#61) — one BYOK LLM key per user, server-encrypted.
  // ---------------------------------------------------------------------

  /** The owner's saved key, decrypted by the server, or null if none is stored. */
  async getProviderKey(): Promise<ProviderKey | null> {
    const res = await this.request("getProviderKey", "/api/provider-key");
    return (await res.json()) as ProviderKey | null;
  }

  async saveProviderKey(key: ProviderKey): Promise<void> {
    await this.request("saveProviderKey", "/api/provider-key", {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(key),
    });
  }

  async deleteProviderKey(): Promise<void> {
    await this.request("deleteProviderKey", "/api/provider-key", { method: "DELETE" });
  }
}

const JSON_HEADERS = { "content-type": "application/json" };
