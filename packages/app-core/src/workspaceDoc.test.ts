import { describe, expect, it } from "vitest";

import { parseWorkspace, serializeWorkspace, WorkspaceParseError } from "./workspaceDoc";

const file = { name: "preprocessing.ipynb", json: '{"cells":[]}' };

function parseError(content: string): WorkspaceParseError {
  let thrown: unknown;
  try {
    parseWorkspace(content);
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(WorkspaceParseError);
  return thrown as WorkspaceParseError;
}

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

  it("serializes a bare file array as a v2 document", () => {
    expect(parseWorkspace(serializeWorkspace([file]))).toEqual({ files: [file] });
  });

  it("keeps old v1 cloud workspaces readable", () => {
    expect(parseWorkspace(JSON.stringify({ version: 1, files: [file] }))).toEqual({
      files: [file],
    });
  });

  it("drops malformed layout/ui metadata instead of failing", () => {
    const json = JSON.stringify({
      version: 2,
      files: [file],
      layout: { groupPositions: { a: { x: "no", y: 1 } } },
      ui: { notebookRatio: "wide", showMinimap: "yes" },
    });
    expect(parseWorkspace(json)).toEqual({ files: [file] });
  });

  it("rejects non-workspace JSON with code notWorkspace", () => {
    expect(parseError(JSON.stringify({ cells: [] })).code).toBe("notWorkspace");
  });

  it("rejects invalid JSON with code notWorkspace", () => {
    expect(parseError("not json {").code).toBe("notWorkspace");
  });

  it("rejects a workspace without notebooks with code noNotebooks", () => {
    expect(parseError(JSON.stringify({ version: 2, files: [] })).code).toBe("noNotebooks");
  });
});
