import { describe, expect, it } from "vitest";

import { extractOutputsByCell, type IpynbDoc, serializeNotebook } from "./notebook";

describe("notebook output helpers", () => {
  it("extracts nbformat outputs for code cells", () => {
    const doc: IpynbDoc = {
      cells: [
        {
          cell_type: "code",
          source: ["print('hi')"],
          outputs: [{ output_type: "stream", name: "stdout", text: ["hi\n"] }],
        },
        {
          cell_type: "markdown",
          source: ["# Title"],
        },
      ],
    };

    expect(extractOutputsByCell(doc)).toEqual({
      0: [{ output_type: "stream", name: "stdout", text: "hi\n" }],
    });
  });

  it("serializes captured outputs into the matching code cells", () => {
    const doc: IpynbDoc = {
      cells: [{ cell_type: "code", source: ["x = 1"], metadata: {}, outputs: [] }],
    };
    const json = serializeNotebook([{ cellType: "code", source: "x = 2" }], doc, {
      0: [{ output_type: "stream", name: "stdout", text: "done\n" }],
    });

    expect(JSON.parse(json)).toMatchObject({
      cells: [
        {
          source: ["x = 2"],
          outputs: [{ output_type: "stream", name: "stdout", text: "done\n" }],
        },
      ],
    });
  });
});
