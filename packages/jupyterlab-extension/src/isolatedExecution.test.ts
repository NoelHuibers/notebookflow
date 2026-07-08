import { describe, expect, it } from "vitest";

import {
  buildIdIndex,
  busKey,
  extractCellSourceFromWrapper,
  resolveInputBindings,
  wrapIsolatedCellCode,
} from "./isolatedExecution";

describe("isolatedExecution", () => {
  it("wraps source in base64 and routes inputs through the internal bus", () => {
    const wrapped = wrapIsolatedCellCode(
      "b",
      "clean = df + 1\n",
      [{ localPort: "df", sourceNodeId: "a", sourcePort: "df" }],
      ["clean"],
    );

    expect(wrapped).toContain("# __notebookflow_isolated__");
    expect(extractCellSourceFromWrapper(wrapped)).toBe("clean = df + 1\n");
    expect(wrapped).toContain(`__nf_bus[${JSON.stringify(busKey("a", "df"))}]`);
    expect(wrapped).toContain(`__nf_bus[${JSON.stringify(busKey("b", "clean"))}]`);
  });

  it("resolves local and qualified input bindings", () => {
    const nodes = [
      { id: "a::0", name: "Load", alias: "nb_a", inputs: [], outputs: ["raw_df"], source: "" },
      {
        id: "b::0",
        name: "Use",
        alias: "nb_b",
        inputs: ["df<-nb_a:Load.raw_df"],
        outputs: [],
        source: "",
      },
    ];
    const idIndex = buildIdIndex(nodes);
    const bindings = resolveInputBindings(nodes[1]!, idIndex);
    expect(bindings).toEqual([{ localPort: "df", sourceNodeId: "a::0", sourcePort: "raw_df" }]);
  });
});
