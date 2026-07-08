import { describe, expect, it } from "vitest";

import type { NodeTag } from "../types";
import twoNode from "./fixtures/two-node.ipynb.json";
import type { NotebookCell } from "./MarkerParser";
import {
  defaultAliasForPath,
  formatInputBinding,
  formatRef,
  MarkerParser,
  parseInputBinding,
  parseRef,
} from "./MarkerParser";

interface IpynbCell {
  cell_type: string;
  source: string | string[];
}
interface IpynbDoc {
  cells: IpynbCell[];
}

function toNotebookCells(doc: IpynbDoc): NotebookCell[] {
  return doc.cells.map((c) => ({
    cellType: c.cell_type as NotebookCell["cellType"],
    source: Array.isArray(c.source) ? c.source.join("") : c.source,
  }));
}

describe("MarkerParser.isValidTag", () => {
  it("accepts every NodeTag value", () => {
    const tags: NodeTag[] = ["input", "transform", "output", "ai", "io"];
    for (const t of tags) {
      expect(MarkerParser.isValidTag(t)).toBe(true);
    }
  });

  it("rejects arbitrary strings", () => {
    for (const t of ["bogus", "", "INPUT", "transform ", "code"]) {
      expect(MarkerParser.isValidTag(t)).toBe(false);
    }
  });
});

describe("MarkerParser.parseLine", () => {
  it("parses a minimal marker", () => {
    const m = MarkerParser.parseLine("# @node: Load CSV  [input]");
    expect(m).toEqual({ name: "Load CSV", tag: "input", inputs: [], outputs: [] });
  });

  it("parses a marker with in= and out=", () => {
    const m = MarkerParser.parseLine("# @node: Filter [transform] in=df<-load_csv.df  out=df");
    expect(m).toEqual({
      name: "Filter",
      tag: "transform",
      inputs: ["df<-load_csv.df"],
      outputs: ["df"],
    });
  });

  it("handles in= and out= in flipped order", () => {
    const m = MarkerParser.parseLine("# @node: Foo [transform] out=df  in=x<-a.x,y<-b.y");
    expect(m).toEqual({
      name: "Foo",
      tag: "transform",
      inputs: ["x<-a.x", "y<-b.y"],
      outputs: ["df"],
    });
  });

  it("tolerates whitespace around commas inside in=", () => {
    const m = MarkerParser.parseLine("# @node: Foo [transform] in=x<-a.x , y<-b.y");
    expect(m?.inputs).toEqual(["x<-a.x", "y<-b.y"]);
  });

  it("preserves spaces inside node names in input refs", () => {
    const m = MarkerParser.parseLine("# @node: Filter [transform] in=df<-Load CSV.df");
    expect(m?.inputs).toEqual(["df<-Load CSV.df"]);
  });

  it("returns null for a blank line", () => {
    expect(MarkerParser.parseLine("   ")).toBeNull();
  });

  it("returns null for a non-marker code line", () => {
    expect(MarkerParser.parseLine("import pandas as pd")).toBeNull();
  });

  it("returns null for a comment that isn't a marker", () => {
    expect(MarkerParser.parseLine("# not a marker")).toBeNull();
  });

  it("throws on missing name", () => {
    expect(() => MarkerParser.parseLine("# @node: [input]")).toThrow();
  });

  it("throws on unknown tag", () => {
    expect(() => MarkerParser.parseLine("# @node: Foo [bogus]")).toThrow();
  });

  it("throws on uppercase port name in input ref", () => {
    expect(() => MarkerParser.parseLine("# @node: Foo [transform] in=port<-Bad.PORT")).toThrow();
  });

  it("throws on input binding missing the arrow", () => {
    expect(() => MarkerParser.parseLine("# @node: Foo [transform] in=load_csv")).toThrow();
  });

  it("throws on input binding source missing the dot", () => {
    expect(() => MarkerParser.parseLine("# @node: Foo [transform] in=df<-load_csv")).toThrow();
  });

  it("throws on unrecognized trailing content", () => {
    expect(() => MarkerParser.parseLine("# @node: Foo [transform] garbage")).toThrow();
  });
});

describe("MarkerParser.formatMarker", () => {
  it("emits canonical form without ports", () => {
    expect(
      MarkerParser.formatMarker({ name: "Load CSV", tag: "input", inputs: [], outputs: [] }),
    ).toBe("# @node: Load CSV  [input]");
  });

  it("emits canonical form with in= and out=", () => {
    expect(
      MarkerParser.formatMarker({
        name: "Filter",
        tag: "transform",
        inputs: ["df<-load_csv.df"],
        outputs: ["df"],
      }),
    ).toBe("# @node: Filter  [transform]  in=df<-load_csv.df  out=df");
  });

  it("omits empty in= and out= sections", () => {
    expect(
      MarkerParser.formatMarker({ name: "Sink", tag: "output", inputs: ["x<-a.x"], outputs: [] }),
    ).toBe("# @node: Sink  [output]  in=x<-a.x");
    expect(
      MarkerParser.formatMarker({ name: "Source", tag: "input", inputs: [], outputs: ["df"] }),
    ).toBe("# @node: Source  [input]  out=df");
  });
});

describe("MarkerParser round-trip", () => {
  const examples = [
    { name: "Load CSV", tag: "input" as const, inputs: [], outputs: [] },
    { name: "Filter", tag: "transform" as const, inputs: ["x<-a.x"], outputs: ["df"] },
    {
      name: "Merge two",
      tag: "transform" as const,
      inputs: ["x<-a.x", "y<-b.y"],
      outputs: ["merged"],
    },
    { name: "Sink", tag: "output" as const, inputs: ["result<-pipeline.result"], outputs: [] },
    {
      name: "AI step",
      tag: "ai" as const,
      inputs: ["text<-prompt.text"],
      outputs: ["completion"],
    },
  ];

  it.each(examples)("parseLine(formatMarker($name)) preserves the marker", (m) => {
    const formatted = MarkerParser.formatMarker(m);
    const reparsed = MarkerParser.parseLine(formatted);
    expect(reparsed).toEqual(m);
  });
});

describe("MarkerParser.parseNotebook", () => {
  it("parses the two-node fixture into 2 markers and 1 error", () => {
    const cells = toNotebookCells(twoNode);
    const result = MarkerParser.parseNotebook("nb/demo.ipynb", cells);

    expect(result.markers).toHaveLength(2);
    expect(result.markers[0]).toEqual({
      name: "Load CSV",
      tag: "input",
      inputs: [],
      outputs: ["df"],
      notebookPath: "nb/demo.ipynb",
      cellIndex: 1,
    });
    expect(result.markers[1]).toEqual({
      name: "Filter",
      tag: "transform",
      inputs: ["df<-Load CSV.df"],
      outputs: ["clean_df"],
      notebookPath: "nb/demo.ipynb",
      cellIndex: 2,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.cellIndex).toBe(4);
  });

  it("skips markdown cells", () => {
    const cells: NotebookCell[] = [
      { cellType: "markdown", source: "# @node: Heading [input]" },
      { cellType: "code", source: "# @node: Real  [input]\nx = 1" },
    ];
    const result = MarkerParser.parseNotebook("nb.ipynb", cells);
    expect(result.markers).toHaveLength(1);
    expect(result.markers[0]?.name).toBe("Real");
  });

  it("only considers the first non-blank line", () => {
    const cells: NotebookCell[] = [
      {
        cellType: "code",
        source: "\n\n  \n# @node: Real  [input]\n# @node: Decoy  [transform]\nx = 1",
      },
    ];
    const result = MarkerParser.parseNotebook("nb.ipynb", cells);
    expect(result.markers).toHaveLength(1);
    expect(result.markers[0]?.name).toBe("Real");
  });
});

describe("MarkerParser — multi-line marker form (#51)", () => {
  it("parses the multi-line form via parseNotebook", () => {
    const cells: NotebookCell[] = [
      {
        cellType: "code",
        source: [
          "# @node: LLM Generate",
          "# @inputs: clean<-Cleaner.out",
          "# @outputs: summary_md",
          "# @tag: ai",
          "summary_md = generate(clean)",
        ].join("\n"),
      },
    ];
    const result = MarkerParser.parseNotebook("nb.ipynb", cells);
    expect(result.errors).toEqual([]);
    expect(result.markers).toHaveLength(1);
    expect(result.markers[0]).toMatchObject({
      name: "LLM Generate",
      tag: "ai",
      inputs: ["clean<-Cleaner.out"],
      outputs: ["summary_md"],
    });
  });

  it("accepts @in/@out aliases and comma-separated refs", () => {
    const lines = [
      "# @node: Merge [transform]",
      "# @in: x<-A.x, y<-B.y",
      "# @out: merged",
      "z = 1",
    ];
    const marker = MarkerParser.parseMarkerBlock(lines);
    expect(marker).toMatchObject({
      name: "Merge",
      tag: "transform",
      inputs: ["x<-A.x", "y<-B.y"],
      outputs: ["merged"],
    });
  });

  it("lets an inline [tag] win over a @tag: continuation line", () => {
    const marker = MarkerParser.parseMarkerBlock(["# @node: N [input]", "# @tag: ai"]);
    expect(marker?.tag).toBe("input");
  });

  it("throws when no tag is given in either form", () => {
    expect(() => MarkerParser.parseMarkerBlock(["# @node: N", "# @inputs: b<-a.b"])).toThrow();
  });

  it("ignores continuation lines that are not part of the leading block", () => {
    const cells: NotebookCell[] = [
      { cellType: "code", source: "# @node: N [input]\nx = 1\n# @inputs: should.ignore" },
    ];
    const result = MarkerParser.parseNotebook("nb.ipynb", cells);
    expect(result.markers[0]).toMatchObject({ name: "N", tag: "input", inputs: [] });
  });
});

describe("MarkerParser.isContinuationLine", () => {
  it("recognises continuation comments only", () => {
    expect(MarkerParser.isContinuationLine("# @inputs: b<-a.b")).toBe(true);
    expect(MarkerParser.isContinuationLine("# @out: df")).toBe(true);
    expect(MarkerParser.isContinuationLine("# @tag: ai")).toBe(true);
    expect(MarkerParser.isContinuationLine("# @node: N [input]")).toBe(false);
    expect(MarkerParser.isContinuationLine("x = 1")).toBe(false);
  });
});

describe("MarkerParser — notebook alias (#18)", () => {
  it("defaults the alias to the sanitised filename stem", () => {
    const result = MarkerParser.parseNotebook("path/to/Orders 2026.ipynb", []);
    expect(result.alias).toBe("orders_2026");
  });

  it("prefixes a stem that does not start with a letter", () => {
    expect(defaultAliasForPath("2026-report.ipynb")).toBe("nb_2026-report");
  });

  it("reads an explicit `# @notebook:` header", () => {
    const cells: NotebookCell[] = [
      { cellType: "code", source: "# @notebook: orders\nimport pandas as pd" },
      { cellType: "code", source: "# @node: Load  [input]  out=df" },
    ];
    const result = MarkerParser.parseNotebook("whatever.ipynb", cells);
    expect(result.alias).toBe("orders");
    // The header cell is not itself a node.
    expect(result.markers).toHaveLength(1);
    expect(result.markers[0]?.name).toBe("Load");
  });

  it("reports an invalid alias as a parse error and falls back to the stem", () => {
    const cells: NotebookCell[] = [{ cellType: "code", source: "# @notebook: Bad Alias" }];
    const result = MarkerParser.parseNotebook("nb.ipynb", cells);
    expect(result.errors).toHaveLength(1);
    expect(result.alias).toBe("nb");
  });

  it("parses an alias-qualified input ref and round-trips it", () => {
    const body = MarkerParser.parseLine("# @node: Filter  [transform]  in=df<-orders:Load CSV.df");
    expect(body?.inputs).toEqual(["df<-orders:Load CSV.df"]);
  });

  it("keeps local and qualified refs distinct in one marker", () => {
    const body = MarkerParser.parseLine(
      "# @node: Join  [transform]  in=a<-Local.a,b<-other:Remote.b",
    );
    expect(body?.inputs).toEqual(["a<-Local.a", "b<-other:Remote.b"]);
  });

  it("rejects a ref with an invalid alias", () => {
    expect(() =>
      MarkerParser.parseLine("# @node: X  [transform]  in=p<-Bad Alias:Node.p"),
    ).toThrow();
  });
});

describe("parseInputBinding / formatInputBinding helpers", () => {
  it("parses a local input binding", () => {
    expect(parseInputBinding("df<-Load CSV.raw_df")).toEqual({
      localName: "df",
      source: {
        alias: null,
        nodeName: "Load CSV",
        portName: "raw_df",
      },
    });
  });

  it("parses a qualified input binding", () => {
    expect(parseInputBinding("df<-orders:Load CSV.raw_df")).toEqual({
      localName: "df",
      source: {
        alias: "orders",
        nodeName: "Load CSV",
        portName: "raw_df",
      },
    });
  });

  it("returns null for a bare source ref", () => {
    expect(parseInputBinding("Load CSV.df")).toBeNull();
  });

  it("round-trips through formatInputBinding", () => {
    expect(
      formatInputBinding({
        localName: "df",
        source: { alias: "a", nodeName: "N", portName: "p" },
      }),
    ).toBe("df<-a:N.p");
  });
});

describe("parseRef / formatRef helpers", () => {
  it("parses a local ref", () => {
    expect(parseRef("Load CSV.df")).toEqual({
      alias: null,
      nodeName: "Load CSV",
      portName: "df",
    });
  });

  it("parses a qualified ref", () => {
    expect(parseRef("orders:Load CSV.df")).toEqual({
      alias: "orders",
      nodeName: "Load CSV",
      portName: "df",
    });
  });

  it("returns null for a structurally invalid ref", () => {
    expect(parseRef("no-dot-here")).toBeNull();
  });

  it("round-trips through formatRef", () => {
    expect(formatRef({ alias: "a", nodeName: "N", portName: "p" })).toBe("a:N.p");
    expect(formatRef({ alias: null, nodeName: "N", portName: "p" })).toBe("N.p");
  });
});
