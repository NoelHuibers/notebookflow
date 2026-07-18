/**
 * Workspace export — serialize every open file's `.ipynb` for the zip
 * download and the cloud save. The active file carries its live cells + run
 * outputs; inactive files come from their frozen snapshots.
 */

import { serializeNotebook } from "@/lib/notebook";
import type { WorkspaceFile } from "@/lib/workspaceZip";
import type {
  CellOutputsByCell,
  FileSnapshot,
  LoadedNotebook,
  OpenFileMeta,
} from "@/types/workspace";

/**
 * Serialize every open file's `.ipynb` — shared by zip export and cloud save.
 * The active file uses the live `notebook` cells and current run outputs;
 * inactive files fall back to their snapshots (a missing snapshot degrades to
 * an empty cell list on the active notebook's document shell).
 */
export function collectWorkspaceFiles(
  openFiles: OpenFileMeta[],
  activeFileId: string,
  notebook: LoadedNotebook,
  outputsByCell: CellOutputsByCell,
  snapshots: ReadonlyMap<string, FileSnapshot>,
): WorkspaceFile[] {
  return openFiles.map((file) => {
    if (file.id === activeFileId) {
      return {
        name: notebook.name,
        json: serializeNotebook(notebook.cells, notebook.doc, outputsByCell),
      };
    }
    const snap = snapshots.get(file.id);
    return {
      name: file.name,
      json: serializeNotebook(
        snap?.cells ?? [],
        snap?.doc ?? notebook.doc,
        snap?.outputsByCell ?? {},
      ),
    };
  });
}
