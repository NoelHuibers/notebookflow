import { describe, expect, it } from "vitest";

import type { NbOutput } from "@/lib/EngineClient";
import type { CellOutputsByCell, OpenFileMeta } from "@/types/workspace";

import {
  createBlankNotebook,
  isLikelyWorkspaceFilename,
  shiftOutputsAfterDelete,
  shiftOutputsAfterInsert,
  uniqueUntitledNotebookName,
} from "./workspaceFiles";

function files(...names: string[]): OpenFileMeta[] {
  return names.map((name, index) => ({ id: `file-${String(index)}`, name }));
}

function stream(text: string): NbOutput[] {
  return [{ output_type: "stream", name: "stdout", text }];
}

describe("uniqueUntitledNotebookName", () => {
  it("starts with Untitled.ipynb when unused", () => {
    expect(uniqueUntitledNotebookName(files("a.ipynb"))).toBe("Untitled.ipynb");
  });

  it("skips to the next free numbered name", () => {
    expect(uniqueUntitledNotebookName(files("Untitled.ipynb"))).toBe("Untitled 2.ipynb");
    expect(uniqueUntitledNotebookName(files("Untitled.ipynb", "Untitled 2.ipynb"))).toBe(
      "Untitled 3.ipynb",
    );
    expect(
      uniqueUntitledNotebookName(files("Untitled.ipynb", "Untitled 2.ipynb", "Untitled 4.ipynb")),
    ).toBe("Untitled 3.ipynb");
  });
});

describe("createBlankNotebook", () => {
  it("creates a single empty code cell with nbformat metadata", () => {
    const notebook = createBlankNotebook("fresh.ipynb");
    expect(notebook.name).toBe("fresh.ipynb");
    expect(notebook.cells).toEqual([{ cellType: "code", source: "" }]);
    expect(notebook.doc.cells).toHaveLength(1);
    expect(notebook.doc.nbformat).toBe(4);
    expect(notebook.doc.nbformat_minor).toBe(5);
    expect(notebook.doc.metadata).toEqual({
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
    });
  });
});

describe("isLikelyWorkspaceFilename", () => {
  it("accepts workspace extensions case-insensitively", () => {
    expect(isLikelyWorkspaceFilename("demo.notebookflow.json")).toBe(true);
    expect(isLikelyWorkspaceFilename("demo.notebookflow")).toBe(true);
    expect(isLikelyWorkspaceFilename("demo.nfw")).toBe(true);
    expect(isLikelyWorkspaceFilename("DEMO.NotebookFlow.JSON")).toBe(true);
  });

  it("rejects notebooks and other files", () => {
    expect(isLikelyWorkspaceFilename("demo.ipynb")).toBe(false);
    expect(isLikelyWorkspaceFilename("demo.json")).toBe(false);
    expect(isLikelyWorkspaceFilename("demo.txt")).toBe(false);
  });
});

describe("shiftOutputsAfterDelete", () => {
  it("drops the deleted index and shifts later outputs down", () => {
    const outputs: CellOutputsByCell = {
      0: stream("a"),
      1: stream("b"),
      2: stream("c"),
    };
    expect(shiftOutputsAfterDelete(outputs, 1)).toEqual({
      0: stream("a"),
      1: stream("c"),
    });
  });

  it("keeps earlier indices untouched", () => {
    const outputs: CellOutputsByCell = { 0: stream("a"), 3: stream("d") };
    expect(shiftOutputsAfterDelete(outputs, 5)).toEqual({ 0: stream("a"), 3: stream("d") });
  });
});

describe("shiftOutputsAfterInsert", () => {
  it("shifts outputs at and after the inserted index up", () => {
    const outputs: CellOutputsByCell = {
      0: stream("a"),
      1: stream("b"),
      2: stream("c"),
    };
    expect(shiftOutputsAfterInsert(outputs, 1)).toEqual({
      0: stream("a"),
      2: stream("b"),
      3: stream("c"),
    });
  });

  it("appending past the end leaves existing outputs alone", () => {
    const outputs: CellOutputsByCell = { 0: stream("a"), 1: stream("b") };
    expect(shiftOutputsAfterInsert(outputs, 2)).toEqual({ 0: stream("a"), 1: stream("b") });
  });
});
