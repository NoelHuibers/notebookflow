/**
 * Data files over the Jupyter Contents API.
 *
 * The kernel execution path runs node code with the notebook's directory as
 * its working directory (the kernel's cwd on the Jupyter server), so files
 * uploaded to the ENGINE's data dir are invisible to kernel runs. When a live
 * kernel is attached, the correct upload target is therefore the notebook's
 * own directory via `app.serviceManager.contents`; the engine `/files` REST
 * surface remains the fallback for engine-path runs.
 */

import type { Contents } from "@jupyterlab/services";
import type { DataFile } from "@notebookflow/app-core";

/** Extensions surfaced in the Data rail (matches the VS Code upload filter). */
export const DATA_FILE_EXTENSIONS: readonly string[] = [
  ".csv",
  ".tsv",
  ".json",
  ".parquet",
  ".txt",
  ".xlsx",
];

/** Directory part of a Contents API path ("" for the server root). */
export function notebookDirname(notebookPath: string): string {
  const idx = notebookPath.lastIndexOf("/");
  return idx === -1 ? "" : notebookPath.slice(0, idx);
}

export function joinContentsPath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

export function isDataFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return DATA_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** List data files in the notebook's directory via the Contents API. */
export async function listNotebookDataFiles(
  contents: Contents.IManager,
  dir: string,
): Promise<DataFile[]> {
  const model = await contents.get(dir, { content: true });
  const entries = Array.isArray(model.content) ? (model.content as Contents.IModel[]) : [];
  return entries
    .filter((entry) => entry.type === "file" && isDataFileName(entry.name))
    .map((entry) => ({ name: entry.name, size: entry.size ?? 0 }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Upload a browser File into the notebook's directory via the Contents API.
 * Base64 keeps binary formats (parquet/xlsx) intact.
 */
export async function uploadNotebookDataFile(
  contents: Contents.IManager,
  dir: string,
  file: File,
): Promise<void> {
  const buffer = await file.arrayBuffer();
  await contents.save(joinContentsPath(dir, file.name), {
    type: "file",
    format: "base64",
    content: toBase64(buffer),
  });
}

export async function deleteNotebookDataFile(
  contents: Contents.IManager,
  dir: string,
  name: string,
): Promise<void> {
  await contents.delete(joinContentsPath(dir, name));
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
