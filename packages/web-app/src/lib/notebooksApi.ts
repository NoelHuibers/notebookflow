/**
 * Client for the per-user notebook persistence API (#60). Thin adapter over
 * app-core's CloudClient (cookie mode: same-origin fetch with the session
 * cookie; the server scopes everything to the signed-in user) and
 * workspaceDoc, mapping app-core's typed errors to LocalizableError so UI
 * copy resolves through the catalog.
 */

import {
  CloudClient,
  CloudRequestError,
  type NotebookRecord,
  type NotebookSummary,
  type ParsedWorkspace,
  parseWorkspace as parseWorkspaceDoc,
  type SavedWorkspace,
  type SavedWorkspaceV1,
  type SavedWorkspaceV2,
  serializeWorkspace,
  type WorkspaceLayoutState,
  WorkspaceParseError,
  type WorkspacePosition,
  type WorkspaceUiState,
} from "@notebookflow/app-core";

import { LocalizableError } from "@/lib/errors";

export type {
  NotebookRecord,
  NotebookSummary,
  ParsedWorkspace,
  SavedWorkspace,
  SavedWorkspaceV1,
  SavedWorkspaceV2,
  WorkspaceLayoutState,
  WorkspacePosition,
  WorkspaceUiState,
};
export { serializeWorkspace };

const client = new CloudClient("", "", { credentials: "include" });

export function parseWorkspace(content: string): ParsedWorkspace {
  try {
    return parseWorkspaceDoc(content);
  } catch (err) {
    if (err instanceof WorkspaceParseError) {
      throw new LocalizableError(
        err.code === "noNotebooks" ? "app.errors.workspaceNoNotebooks" : "app.errors.notWorkspace",
      );
    }
    throw err;
  }
}

/** Map cloud failures to the catalog key the dialogs already render. */
async function localized<T>(action: Promise<T>): Promise<T> {
  try {
    return await action;
  } catch (err) {
    if (err instanceof CloudRequestError) {
      throw new LocalizableError("app.errors.cloudRequestFailed", { status: err.status });
    }
    throw err;
  }
}

export async function listNotebooks(): Promise<NotebookSummary[]> {
  return localized(client.listNotebooks());
}

export async function getNotebook(id: string): Promise<NotebookRecord> {
  return localized(client.getNotebook(id));
}

export async function createNotebook(name: string, content: string): Promise<NotebookSummary> {
  return localized(client.createNotebook(name, content));
}

export async function updateNotebook(
  id: string,
  patch: { name?: string; content?: string },
): Promise<NotebookSummary> {
  return localized(client.updateNotebook(id, patch));
}

export async function deleteNotebook(id: string): Promise<void> {
  return localized(client.deleteNotebook(id));
}
