import { describe, expect, it } from "vitest";

import { parseWorkspace, serializeWorkspace } from "./notebooksApi";

const file = { name: "preprocessing.ipynb", json: '{"cells":[]}' };

describe("workspace serialization", () => {
  it("round-trips v2 workspace metadata", () => {
    const json = serializeWorkspace({
      files: [file],
      activeFileName: "preprocessing.ipynb",
      layout: { groupPositions: { "preprocessing.ipynb": { x: 12, y: 34 } } },
      ui: { notebookRatio: 42, showMinimap: true, sidebarCollapsed: false },
    });

    expect(parseWorkspace(json)).toEqual({
      files: [file],
      activeFileName: "preprocessing.ipynb",
      layout: { groupPositions: { "preprocessing.ipynb": { x: 12, y: 34 } } },
      ui: { notebookRatio: 42, showMinimap: true, sidebarCollapsed: false },
    });
  });

  it("keeps old v1 cloud workspaces readable", () => {
    expect(parseWorkspace(JSON.stringify({ version: 1, files: [file] }))).toEqual({
      files: [file],
    });
  });

  it("rejects non-workspace JSON", () => {
    expect(() => parseWorkspace(JSON.stringify({ cells: [] }))).toThrow(
      "Not a NotebookFlow workspace",
    );
  });
});
