/**
 * Client for the per-user notebook persistence API (#60). Same-origin fetch
 * with the session cookie; server scopes everything to the signed-in user.
 */

import type { WorkspaceFile } from "@/lib/workspaceZip";

export interface NotebookSummary {
  id: string;
  name: string;
  updatedAt: number;
}

export interface NotebookRecord extends NotebookSummary {
  content: string;
}

/** Serialized workspace stored in a notebook row's `content`. */
export interface SavedWorkspace {
  version: 1;
  files: WorkspaceFile[];
}

export function serializeWorkspace(files: WorkspaceFile[]): string {
  return JSON.stringify({ version: 1, files } satisfies SavedWorkspace);
}

export function parseWorkspace(content: string): WorkspaceFile[] {
  const parsed = JSON.parse(content) as SavedWorkspace;
  return Array.isArray(parsed.files) ? parsed.files : [];
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`/api/notebooks${path}`, { credentials: "include", ...init });
  if (!res.ok) {
    throw new Error(`notebooks ${init?.method ?? "GET"} ${path || "/"} failed: ${res.status}`);
  }
  return res;
}

const jsonHeaders = { "content-type": "application/json" };

export async function listNotebooks(): Promise<NotebookSummary[]> {
  return (await request("")).json();
}

export async function getNotebook(id: string): Promise<NotebookRecord> {
  return (await request(`/${encodeURIComponent(id)}`)).json();
}

export async function createNotebook(name: string, content: string): Promise<NotebookSummary> {
  return (
    await request("", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ name, content }),
    })
  ).json();
}

export async function updateNotebook(
  id: string,
  patch: { name?: string; content?: string },
): Promise<NotebookSummary> {
  return (
    await request(`/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(patch),
    })
  ).json();
}

export async function deleteNotebook(id: string): Promise<void> {
  await request(`/${encodeURIComponent(id)}`, { method: "DELETE" });
}
