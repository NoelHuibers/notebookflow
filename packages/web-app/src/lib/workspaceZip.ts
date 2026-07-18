import JSZip from "jszip";

import { triggerDownload } from "./download";

/** One open file's serialized notebook, ready to drop into the zip. */
export interface WorkspaceFile {
  name: string;
  json: string;
}

/** Normalize a workspace file name into its zip entry name. */
export function zipEntryName(name: string): string {
  return name.endsWith(".ipynb") ? name : `${name}.ipynb`;
}

/**
 * Bundle every open file's `.ipynb` into a single zip and trigger a download.
 * With multiple files open, a single "Download" of one notebook is ambiguous —
 * this exports the whole workspace at once.
 */
export async function downloadWorkspaceZip(
  files: WorkspaceFile[],
  zipName = "notebookflow-workspace.zip",
): Promise<void> {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(zipEntryName(file.name), file.json);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(blob, zipName);
}

export function downloadWorkspaceDocument(
  content: string,
  filename = "workspace.notebookflow.json",
): void {
  triggerDownload(new Blob([content], { type: "application/json" }), filename);
}
