import type { NotebookCell } from "@notebookflow/graph-canvas/sync";
import { describe, expect, it } from "vitest";

import type { NbOutput } from "@/lib/EngineClient";
import type { FileSnapshot, LoadedNotebook, OpenFileMeta } from "@/types/workspace";

import type { IpynbDoc } from "./notebook";
import { collectWorkspaceFiles } from "./workspaceExport";

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
    outputsByCell: {},
  };
}

function streamOutput(text: string): NbOutput {
  return { output_type: "stream", name: "stdout", text };
}

function joinSource(source: string | string[] | undefined): string {
  return Array.isArray(source) ? source.join("") : (source ?? "");
}

const activeNotebook: LoadedNotebook = {
  name: "a.ipynb",
  cells: [codeCell("x = 1\n")],
  doc: docFor([codeCell("x = 0\n")]),
};

describe("collectWorkspaceFiles", () => {
  it("serializes the active file from live cells and current outputs", () => {
    const snapshots = new Map<string, FileSnapshot>([
      [inactiveFileId, snapshot([codeCell("y = 2\n")])],
    ]);

    const files = collectWorkspaceFiles(
      openFiles,
      activeFileId,
      activeNotebook,
      { 0: [streamOutput("hello\n")] },
      snapshots,
    );

    expect(files).toHaveLength(2);
    expect(files[0]?.name).toBe("a.ipynb");
    const doc = JSON.parse(files[0]?.json ?? "") as IpynbDoc;
    // Live cell source wins over the stale doc source.
    expect(joinSource(doc.cells[0]?.source)).toBe("x = 1\n");
    expect(doc.cells[0]?.outputs).toEqual([streamOutput("hello\n")]);
  });

  it("serializes an inactive file from its snapshot", () => {
    const snapshots = new Map<string, FileSnapshot>([
      [inactiveFileId, snapshot([codeCell("y = 2\n")])],
    ]);

    const files = collectWorkspaceFiles(openFiles, activeFileId, activeNotebook, {}, snapshots);

    expect(files[1]?.name).toBe("b.ipynb");
    const doc = JSON.parse(files[1]?.json ?? "") as IpynbDoc;
    expect(doc.cells).toHaveLength(1);
    expect(joinSource(doc.cells[0]?.source)).toBe("y = 2\n");
  });

  it("degrades a missing snapshot to an empty cell list", () => {
    const files = collectWorkspaceFiles(
      openFiles,
      activeFileId,
      activeNotebook,
      {},
      new Map<string, FileSnapshot>(),
    );

    expect(files[1]?.name).toBe("b.ipynb");
    const doc = JSON.parse(files[1]?.json ?? "") as IpynbDoc;
    expect(doc.cells).toEqual([]);
  });
});
