import JSZip from "jszip";

/** One open file's serialized notebook, ready to drop into the zip. */
export interface WorkspaceFile {
  name: string;
  json: string;
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
    const entry = file.name.endsWith(".ipynb") ? file.name : `${file.name}.ipynb`;
    zip.file(entry, file.json);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = zipName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
