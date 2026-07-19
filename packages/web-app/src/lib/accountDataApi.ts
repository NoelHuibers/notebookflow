/** Browser helpers for GDPR export and account deletion (#79). */

import JSZip from "jszip";
import { triggerDownload } from "@/lib/download";
import type { EngineClient } from "@/lib/EngineClient";
import { LocalizableError } from "@/lib/errors";
import type { AccountDataExport, AccountExportNotebook } from "@/types/account";

export interface AccountExportDataFile {
  name: string;
  size: number;
  content: Blob;
}

export function isAccountDeleteConfirmed(value: string, email: string): boolean {
  return value.trim().toLocaleLowerCase() === email.trim().toLocaleLowerCase();
}

export function safeArchiveSegment(value: string): string {
  const leaf = value.replace(/\\/g, "/").split("/").at(-1) ?? "";
  const withoutControls = Array.from(leaf, (character) =>
    character.charCodeAt(0) < 32 ? "-" : character,
  ).join("");
  const safe = withoutControls
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .trim();
  return safe === "" ? "item" : safe;
}

function notebookEntryName(notebook: AccountExportNotebook): string {
  const name = safeArchiveSegment(notebook.name).replace(/\.notebookflow\.json$/i, "");
  return `notebooks/${name}-${safeArchiveSegment(notebook.id)}.notebookflow.json`;
}

export async function buildAccountExportArchive(
  accountData: AccountDataExport,
  dataFiles: AccountExportDataFile[],
): Promise<Blob> {
  const zip = new JSZip();
  zip.file(
    "notebookflow-account.json",
    JSON.stringify(
      {
        ...accountData,
        dataFiles: dataFiles.map(({ name, size }) => ({ name, size })),
      },
      null,
      2,
    ),
  );
  for (const notebook of accountData.notebooks) {
    zip.file(notebookEntryName(notebook), notebook.content);
  }
  for (const dataFile of dataFiles) {
    zip.file(
      `data-files/${safeArchiveSegment(dataFile.name)}`,
      await dataFile.content.arrayBuffer(),
    );
  }
  return zip.generateAsync({ type: "blob" });
}

async function getAccountData(): Promise<AccountDataExport> {
  const response = await fetch("/api/account/export", {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new LocalizableError("settings.dataExportFailed", { status: response.status });
  }
  return response.json();
}

export async function downloadAccountData(engineClient: EngineClient): Promise<void> {
  const [accountData, fileMetadata] = await Promise.all([
    getAccountData(),
    engineClient.listDataFiles(),
  ]);
  const dataFiles = await Promise.all(
    fileMetadata.map(async ({ name, size }) => ({
      name,
      size,
      content: await engineClient.downloadDataFile(name),
    })),
  );
  const archive = await buildAccountExportArchive(accountData, dataFiles);
  const date = accountData.exportedAt.slice(0, 10);
  triggerDownload(archive, `notebookflow-data-export-${date}.zip`);
}

export async function deleteAccount(): Promise<void> {
  const response = await fetch("/api/auth/delete-user", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new LocalizableError("settings.accountDeletionFailed", { status: response.status });
  }
}
