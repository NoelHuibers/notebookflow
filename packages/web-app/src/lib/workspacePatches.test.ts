import type { CellPatch, NotebookCell } from "@notebookflow/graph-canvas/sync";
import { describe, expect, it } from "vitest";

import type { FileSnapshot, OpenFileMeta } from "@/types/workspace";

import type { IpynbDoc } from "./notebook";
import { applyPatchToSnapshot, resolveWorkspacePatchTarget } from "./workspacePatches";

const activeFileId = "file-a";
const inactiveFileId = "file-b";

const openFiles: OpenFileMeta[] = [
  { id: activeFileId, name: "a.ipynb" },
  { id: inactiveFileId, name: "b.ipynb" },
];

function codeCell(source: string): NotebookCell {
  return { cellType: "code", source };
}

function docFor(cells: NotebookCell[]): IpynbDoc {
  return {
    cells: cells.map((cell) => ({ cell_type: cell.cellType, source: [cell.source], metadata: {} })),
  };
}

function snapshot(cells: NotebookCell[]): FileSnapshot {
  return {
    cells,
    doc: docFor(cells),
    baseline: cells.map((cell) => cell.source),
    fileHandle: null,
  };
}

describe("workspace patch routing", () => {
  it("routes an inactive notebook patch to that file's snapshot", () => {
    const inactiveSnapshot = snapshot([codeCell("# @node: Use  [transform]\n")]);
    const snapshots = new Map([[inactiveFileId, inactiveSnapshot]]);

    const target = resolveWorkspacePatchTarget(
      {
        openFiles,
        activeFileId,
        activeNotebookName: "a.ipynb",
        snapshots,
      },
      "b.ipynb",
    );

    expect(target).toMatchObject({ kind: "snapshot", fileId: inactiveFileId, name: "b.ipynb" });
  });

  it("keeps active notebook patches on the active notebook even if a stale snapshot exists", () => {
    const snapshots = new Map([[activeFileId, snapshot([codeCell("# @node: Old  [input]\n")])]]);

    const target = resolveWorkspacePatchTarget(
      {
        openFiles,
        activeFileId,
        activeNotebookName: "a.ipynb",
        snapshots,
      },
      "a.ipynb",
    );

    expect(target).toEqual({ kind: "active" });
  });

  it("applies an inactive patch without touching snapshot bookkeeping", () => {
    const cells = [codeCell("# @node: Use  [transform]\n")];
    const original = snapshot(cells);
    const patch: CellPatch = {
      notebookPath: "b.ipynb",
      cellIndex: 0,
      operation: "replace",
      newSource: "# @node: Use  [transform]  in=a:Load.df\n",
    };

    const patched = applyPatchToSnapshot(original, "b.ipynb", patch);

    expect(patched.cells[0]?.source).toContain("in=a:Load.df");
    expect(original.cells[0]?.source).not.toContain("in=a:Load.df");
    expect(patched.baseline).toEqual(original.baseline);
    expect(patched.fileHandle).toBe(original.fileHandle);
  });
});
