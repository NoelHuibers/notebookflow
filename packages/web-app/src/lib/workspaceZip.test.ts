import { describe, expect, it } from "vitest";

import { zipEntryName } from "./workspaceZip";

describe("zipEntryName", () => {
  it("keeps names that already end in .ipynb", () => {
    expect(zipEntryName("analysis.ipynb")).toBe("analysis.ipynb");
  });

  it("appends .ipynb to bare names", () => {
    expect(zipEntryName("analysis")).toBe("analysis.ipynb");
  });

  it("does not double-append for names with other extensions", () => {
    expect(zipEntryName("analysis.json")).toBe("analysis.json.ipynb");
  });
});
