/**
 * Cloud notebooks (#60) — save/open/delete the signed-in user's workspaces
 * in Turso, plus the dialog's open/list/busy/error state. `detach()` drops
 * the linkage to the opened cloud record so the next save creates a new one.
 */

import type { TFunction } from "i18next";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useState } from "react";

import { formatError } from "@/lib/errors";
import {
  createNotebook,
  deleteNotebook,
  getNotebook,
  listNotebooks,
  type NotebookSummary,
  type ParsedWorkspace,
  parseWorkspace,
  serializeWorkspace,
  updateNotebook,
} from "@/lib/notebooksApi";

export interface UseCloudNotebooksOptions {
  /** Full workspace document collector (useWorkspaceExport). */
  collectWorkspaceDocument: () => ParsedWorkspace;
  /** Replace the whole workspace with a parsed document (useWorkspaceFiles). */
  applyWorkspaceDocument: (workspace: ParsedWorkspace) => void;
  /** The active notebook's name — used as the cloud record's name on save. */
  activeName: string;
  t: TFunction;
}

export interface CloudNotebooks {
  isCloudOpen: boolean;
  setIsCloudOpen: Dispatch<SetStateAction<boolean>>;
  cloudList: NotebookSummary[];
  cloudId: string | null;
  cloudBusy: boolean;
  cloudError: string | null;
  refreshCloudList: () => Promise<void>;
  handleSaveToCloud: () => Promise<void>;
  handleOpenFromCloud: (id: string) => Promise<void>;
  handleDeleteFromCloud: (id: string) => Promise<void>;
  /** Detach from the opened cloud record; the next save creates a new one. */
  detach: () => void;
}

export function useCloudNotebooks({
  collectWorkspaceDocument,
  applyWorkspaceDocument,
  activeName,
  t,
}: UseCloudNotebooksOptions): CloudNotebooks {
  const [isCloudOpen, setIsCloudOpen] = useState(false);
  const [cloudList, setCloudList] = useState<NotebookSummary[]>([]);
  const [cloudId, setCloudId] = useState<string | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);

  const refreshCloudList = useCallback(async (): Promise<void> => {
    try {
      setCloudList(await listNotebooks());
    } catch {
      // signed out / offline — leave the list as-is.
    }
  }, []);

  const handleSaveToCloud = useCallback(async (): Promise<void> => {
    setCloudBusy(true);
    setCloudError(null);
    try {
      const content = serializeWorkspace(collectWorkspaceDocument());
      if (cloudId !== null) {
        await updateNotebook(cloudId, { name: activeName, content });
      } else {
        setCloudId((await createNotebook(activeName, content)).id);
      }
      await refreshCloudList();
    } catch (err) {
      setCloudError(formatError(t, err, "app.errors.cloudSaveFailed"));
    } finally {
      setCloudBusy(false);
    }
  }, [collectWorkspaceDocument, cloudId, activeName, refreshCloudList, t]);

  const handleOpenFromCloud = useCallback(
    async (id: string): Promise<void> => {
      setCloudBusy(true);
      setCloudError(null);
      try {
        const record = await getNotebook(id);
        applyWorkspaceDocument(parseWorkspace(record.content));
        setCloudId(id);
        setIsCloudOpen(false);
      } catch (err) {
        setCloudError(formatError(t, err, "app.errors.cloudOpenFailed"));
      } finally {
        setCloudBusy(false);
      }
    },
    [applyWorkspaceDocument, t],
  );

  const handleDeleteFromCloud = useCallback(
    async (id: string): Promise<void> => {
      setCloudBusy(true);
      setCloudError(null);
      try {
        await deleteNotebook(id);
        if (cloudId === id) setCloudId(null);
        await refreshCloudList();
      } catch (err) {
        setCloudError(formatError(t, err, "app.errors.cloudDeleteFailed"));
      } finally {
        setCloudBusy(false);
      }
    },
    [cloudId, refreshCloudList, t],
  );

  const detach = useCallback((): void => {
    setCloudId(null);
  }, []);

  return {
    isCloudOpen,
    setIsCloudOpen,
    cloudList,
    cloudId,
    cloudBusy,
    cloudError,
    refreshCloudList,
    handleSaveToCloud,
    handleOpenFromCloud,
    handleDeleteFromCloud,
    detach,
  };
}
