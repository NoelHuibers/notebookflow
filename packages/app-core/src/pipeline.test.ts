import type { GraphModel } from "@notebookflow/graph-canvas";
import type { NotebookCell } from "@notebookflow/graph-canvas/sync";
import { describe, expect, it } from "vitest";

import { buildNodeAuthorContext, buildPipelineDef, stripMarkerLine } from "./pipeline";

describe("stripMarkerLine", () => {
  it("strips a leading # @node: marker line", () => {
    expect(stripMarkerLine("# @node: Load [input]\nimport pandas as pd")).toBe(
      "import pandas as pd",
    );
  });

  it("leaves marker-less sources untouched", () => {
    expect(stripMarkerLine("import pandas as pd\ndf = pd.DataFrame()")).toBe(
      "import pandas as pd\ndf = pd.DataFrame()",
    );
  });

  it("returns empty for a single-line source (marker-only cell)", () => {
    expect(stripMarkerLine("# @node: Load [input]")).toBe("");
  });
});

describe("buildPipelineDef", () => {
  it("folds graph nodes, group aliases, and cell sources into a PipelineDef", () => {
    const graph: GraphModel = {
      nodes: {
        n1: {
          id: "n1",
          name: "Load",
          tag: "input",
          inputs: [],
          outputs: ["df"],
          cellIndices: [0],
          groupId: "g1",
        },
        n2: {
          id: "n2",
          name: "Clean",
          tag: "transform",
          inputs: ["df<-Load.df"],
          outputs: ["clean"],
          cellIndices: [1],
          groupId: "g1",
        },
      },
      groups: {
        g1: {
          id: "g1",
          notebookPath: "main.ipynb",
          name: "main",
          alias: "main",
          nodeIds: ["n1", "n2"],
          collapsed: false,
        },
      },
      wires: {
        w1: {
          id: "w1",
          sourceNodeId: "n1",
          sourcePort: "df",
          targetNodeId: "n2",
          targetPort: "df",
        },
      },
    };
    const cells: NotebookCell[] = [
      { cellType: "code", source: "# @node: Load [input]\nimport pandas as pd" },
      { cellType: "code", source: "# @node: Clean [transform]\nclean = df.dropna()" },
    ];
    const def = buildPipelineDef(graph, new Map([["main.ipynb", cells]]));

    expect(def.nodes).toEqual([
      {
        id: "n1",
        name: "Load",
        tag: "input",
        inputs: [],
        outputs: ["df"],
        source: "import pandas as pd",
        notebookPath: "main.ipynb",
        cellIndices: [0],
        alias: "main",
      },
      {
        id: "n2",
        name: "Clean",
        tag: "transform",
        inputs: ["df<-Load.df"],
        outputs: ["clean"],
        source: "clean = df.dropna()",
        notebookPath: "main.ipynb",
        cellIndices: [1],
        alias: "main",
      },
    ]);
    expect(def.edges).toEqual([
      { sourceNodeId: "n1", sourcePort: "df", targetNodeId: "n2", targetPort: "df" },
    ]);
  });

  it("falls back to the groupId path and empty alias when the group is missing", () => {
    const graph: GraphModel = {
      nodes: {
        n1: {
          id: "n1",
          name: "Orphan",
          tag: "transform",
          inputs: [],
          outputs: [],
          cellIndices: [0],
          groupId: "ghost.ipynb",
        },
      },
      groups: {},
      wires: {},
    };
    const def = buildPipelineDef(graph, new Map());
    expect(def.nodes[0]).toMatchObject({
      notebookPath: "ghost.ipynb",
      alias: "",
      source: "",
    });
  });
});

describe("buildNodeAuthorContext", () => {
  const graph: GraphModel = {
    nodes: {
      n1: {
        id: "n1",
        name: "Load CSV",
        tag: "input",
        inputs: [],
        outputs: ["df"],
        cellIndices: [0],
        groupId: "g1",
      },
      n2: {
        id: "n2",
        name: "Clean",
        tag: "transform",
        inputs: ["df<-Load CSV.df"],
        outputs: ["clean", "dropped"],
        cellIndices: [1],
        groupId: "g1",
      },
      // Output-less node: nothing to bind to, so it is omitted.
      n3: {
        id: "n3",
        name: "Plot",
        tag: "output",
        inputs: ["clean<-Clean.clean"],
        outputs: [],
        cellIndices: [2],
        groupId: "g1",
      },
      // Blank-named node: skipped so the binding source stays resolvable.
      n4: {
        id: "n4",
        name: "  ",
        tag: "transform",
        inputs: [],
        outputs: ["x"],
        cellIndices: [3],
        groupId: "g1",
      },
    },
    groups: {},
    wires: {},
  };

  it("returns each named node with outputs as name + output ports", () => {
    expect(buildNodeAuthorContext(graph)).toEqual({
      upstream: [
        { nodeName: "Load CSV", outputPorts: ["df"] },
        { nodeName: "Clean", outputPorts: ["clean", "dropped"] },
      ],
    });
  });

  it("includes the notebook name only when provided", () => {
    expect(buildNodeAuthorContext(graph, "analysis.ipynb").notebookName).toBe("analysis.ipynb");
    expect(buildNodeAuthorContext(graph)).not.toHaveProperty("notebookName");
  });

  it("returns an empty upstream list for an empty graph", () => {
    const empty: GraphModel = { nodes: {}, groups: {}, wires: {} };
    expect(buildNodeAuthorContext(empty)).toEqual({ upstream: [] });
  });
});
