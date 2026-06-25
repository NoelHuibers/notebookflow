/**
 * Client for the opt-in server-side BYOK provider key (#61). Same-origin,
 * session-cookie authenticated; the server scopes everything to the owner.
 */

export interface ProviderKey {
  provider: string;
  model: string;
  apiKey: string;
}

/** The owner's saved key, decrypted, or null if none is stored. */
export async function getProviderKey(): Promise<ProviderKey | null> {
  const res = await fetch("/api/provider-key", { credentials: "include" });
  if (!res.ok) throw new Error(`provider-key GET failed: ${res.status}`);
  return res.json();
}

export async function saveProviderKey(key: ProviderKey): Promise<void> {
  const res = await fetch("/api/provider-key", {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(key),
  });
  if (!res.ok) throw new Error(`provider-key PUT failed: ${res.status}`);
}

export async function deleteProviderKey(): Promise<void> {
  const res = await fetch("/api/provider-key", { method: "DELETE", credentials: "include" });
  if (!res.ok) throw new Error(`provider-key DELETE failed: ${res.status}`);
}
