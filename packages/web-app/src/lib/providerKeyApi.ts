/**
 * Client for the opt-in server-side BYOK provider key (#61). Thin adapter
 * over app-core's CloudClient in cookie mode (same-origin, session-cookie
 * authenticated; the server scopes everything to the owner).
 */

import { CloudClient, type ProviderKey } from "@notebookflow/app-core";

export type { ProviderKey };

const client = new CloudClient("", "", { credentials: "include" });

/** The owner's saved key, decrypted, or null if none is stored. */
export async function getProviderKey(): Promise<ProviderKey | null> {
  return client.getProviderKey();
}

export async function saveProviderKey(key: ProviderKey): Promise<void> {
  return client.saveProviderKey(key);
}

export async function deleteProviderKey(): Promise<void> {
  return client.deleteProviderKey();
}
