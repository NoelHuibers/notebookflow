import { beforeEach, describe, expect, it } from "vitest";

import type { GraphModel } from "../types";
import crossA from "./fixtures/cross-notebook-a.ipynb.json";
import crossB from "./fixtures/cross-notebook-b.ipynb.json";
import twoNode from "./fixtures/two-node.ipynb.json";
import type { NotebookCell } from "./MarkerParser";
import type { CellPatch, SyncEngineOptions } from "./SyncEngine";
import { SyncEngine } from "./SyncEngine";

interface IpynbCell {
  cell_type: string;
  source: string | string[];
  metadata?: Record<string, unknown>;
}
interface IpynbDoc {
  cells: IpynbCell[];
}

function toNotebookCells(doc: IpynbDoc): NotebookCell[] {
  return doc.cells.map((c) => ({
    cellType: c.cell_type as NotebookCell["cellType"],
    source: Array.isArray(c.source) ? c.source.join("") : c.source,
    ...(c.metadata === undefined ? {} : { metadata: c.metadata }),
  }));
}

interface Adapter {
  patches: CellPatch[];
  graphs: GraphModel[];
  options: SyncEngineOptions;
}

function recordingAdapter(extra: Partial<SyncEngineOptions> = {}): Adapter {
  const patches: CellPatch[] = [];
  const graphs: GraphModel[] = [];
  const onCellPatch = (p: CellPatch): Promise<void> => {
    patches.push(p);
    return Promise.resolve();
  };
  const onGraphUpdate = (g: GraphModel): void => {
    graphs.push(g);
  };
  return { patches, graphs, options: { onCellPatch, onGraphUpdate, ...extra } };
}

const TWO_NODE_PATH = "nb/demo.ipynb";
const A_PATH = "nb/a.ipynb";
const B_PATH = "nb/b.ipynb";

describe("SyncEngine.ingestNotebook", () => {
  let adapter: Adapter;
  let engine: SyncEngine;

  beforeEach(() => {
    adapter = recordingAdapter();
    engine = new SyncEngine(adapter.options);
  });

  it("builds 1 group, 2 nodes, 1 wire from the two-node fixture", async () => {
    const cells = toNotebookCells(twoNode);
    await engine.ingestNotebook(TWO_NODE_PATH, cells, 100);

    const graph = engine.getGraph();
    expect(Object.keys(graph.groups)).toHaveLength(1);
    expect(Object.keys(graph.nodes)).toHaveLength(2);
    expect(Object.keys(graph.wires)).toHaveLength(1);

    const group = graph.groups[TWO_NODE_PATH];
    expect(group?.nodeIds).toEqual([`${TWO_NODE_PATH}::1`, `${TWO_NODE_PATH}::2`]);

    const loadCsv = graph.nodes[`${TWO_NODE_PATH}::1`];
    expect(loadCsv?.name).toBe("Load CSV");
    expect(loadCsv?.outputs).toEqual(["df"]);

    const filter = graph.nodes[`${TWO_NODE_PATH}::2`];
    expect(filter?.inputs).toEqual(["Load CSV.df"]);

    const wires = Object.values(graph.wires);
    expect(wires[0]).toMatchObject({
      sourceNodeId: `${TWO_NODE_PATH}::1`,
      sourcePort: "df",
      targetNodeId: `${TWO_NODE_PATH}::2`,
      targetPort: "Load CSV.df",
    });

    expect(adapter.patches).toHaveLength(0);
    expect(adapter.graphs).toHaveLength(1);
  });

  it("is idempotent across repeated ingests", async () => {
    const cells = toNotebookCells(twoNode);
    await engine.ingestNotebook(TWO_NODE_PATH, cells, 100);
    const first = engine.getGraph();
    await engine.ingestNotebook(TWO_NODE_PATH, cells, 200);
    const second = engine.getGraph();
    expect(second).toEqual(first);
  });

  it("drops wires targeting the reingested notebook when markers no longer reference them", async () => {
    const cells = toNotebookCells(twoNode);
    await engine.ingestNotebook(TWO_NODE_PATH, cells, 100);
    expect(Object.keys(engine.getGraph().wires)).toHaveLength(1);

    const withoutRef: NotebookCell[] = cells.map((c, idx) =>
      idx === 2
        ? {
            cellType: "code",
            source: "# @node: Filter  [transform]  out=clean_df\nclean_df = df\n",
          }
        : c,
    );
    await engine.ingestNotebook(TWO_NODE_PATH, withoutRef, 200);
    expect(Object.keys(engine.getGraph().wires)).toHaveLength(0);
  });

  it("drops cross-notebook wires whose source node no longer exists in the graph", async () => {
    const cellsA = toNotebookCells(crossA);
    const cellsB = toNotebookCells(crossB);
    await engine.ingestNotebook(A_PATH, cellsA, 100);
    await engine.ingestNotebook(B_PATH, cellsB, 100);
    expect(Object.keys(engine.getGraph().wires)).toHaveLength(1);

    // Reingest B alone with a new ref pointing to a non-existent node.
    const stale: NotebookCell[] = [
      { cellType: "code", source: "# @node: Filter  [transform]  in=Missing.df  out=clean_df\n" },
    ];
    await engine.ingestNotebook(B_PATH, stale, 200);
    expect(Object.keys(engine.getGraph().wires)).toHaveLength(0);
  });
});

describe("SyncEngine — cross-notebook aliasing (#18)", () => {
  it("defaults a group's alias to its filename stem", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    await engine.ingestNotebook(A_PATH, toNotebookCells(crossA), 100);
    expect(engine.getGraph().groups[A_PATH]?.alias).toBe("a");
  });

  it("resolves a qualified cross-notebook ref to the aliased node", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    await engine.ingestNotebook(A_PATH, toNotebookCells(crossA), 100);
    await engine.ingestNotebook(B_PATH, toNotebookCells(crossB), 100);

    const wires = Object.values(engine.getGraph().wires);
    expect(wires).toHaveLength(1);
    expect(wires[0]).toMatchObject({
      sourceNodeId: `${A_PATH}::0`,
      sourcePort: "df",
      targetNodeId: `${B_PATH}::0`,
      targetPort: "a:Load CSV.df",
    });
  });

  it("does NOT resolve a bare cross-notebook ref (no global-name fallback)", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    await engine.ingestNotebook(A_PATH, toNotebookCells(crossA), 100);
    // B uses a bare `Load CSV.df` (no alias) — resolves locally in B only.
    const bareB: NotebookCell[] = [
      { cellType: "code", source: "# @node: Filter  [transform]  in=Load CSV.df  out=clean\n" },
    ];
    await engine.ingestNotebook(B_PATH, bareB, 100);
    expect(Object.keys(engine.getGraph().wires)).toHaveLength(0);
  });

  it("honours an explicit `# @notebook:` alias header", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    const aCells: NotebookCell[] = [
      { cellType: "code", source: "# @notebook: upstream\n" },
      { cellType: "code", source: "# @node: Load  [input]  out=df\n" },
    ];
    const bCells: NotebookCell[] = [
      { cellType: "code", source: "# @node: Use  [transform]  in=upstream:Load.df  out=r\n" },
    ];
    await engine.ingestNotebook(A_PATH, aCells, 100);
    expect(engine.getGraph().groups[A_PATH]?.alias).toBe("upstream");
    await engine.ingestNotebook(B_PATH, bCells, 100);
    expect(Object.keys(engine.getGraph().wires)).toHaveLength(1);
  });
});

describe("SyncEngine.markCellEdited", () => {
  it("blocks a rename when the cell-edit timestamp is newer than the rename timestamp", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    const cells = toNotebookCells(twoNode);
    await engine.ingestNotebook(TWO_NODE_PATH, cells, 100);

    engine.markCellEdited(TWO_NODE_PATH, 2, 500);
    await engine.renameNode(`${TWO_NODE_PATH}::2`, "Renamed", 200);

    expect(adapter.patches).toHaveLength(0);
    expect(engine.getGraph().nodes[`${TWO_NODE_PATH}::2`]?.name).toBe("Filter");
  });

  it("allows a rename when the rename timestamp is newer than the cell-edit timestamp", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    const cells = toNotebookCells(twoNode);
    await engine.ingestNotebook(TWO_NODE_PATH, cells, 100);

    engine.markCellEdited(TWO_NODE_PATH, 2, 200);
    await engine.renameNode(`${TWO_NODE_PATH}::2`, "Renamed", 500);

    expect(adapter.patches).toHaveLength(1);
    expect(engine.getGraph().nodes[`${TWO_NODE_PATH}::2`]?.name).toBe("Renamed");
  });
});

describe("SyncEngine.renameNode", () => {
  it("emits one CellPatch for a leaf node and preserves the rest of the cell body", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    const cells = toNotebookCells(twoNode);
    await engine.ingestNotebook(TWO_NODE_PATH, cells, 100);

    await engine.renameNode(`${TWO_NODE_PATH}::2`, "Cleaner", 200);

    expect(adapter.patches).toHaveLength(1);
    const patch = adapter.patches[0];
    expect(patch?.notebookPath).toBe(TWO_NODE_PATH);
    expect(patch?.cellIndex).toBe(2);
    expect(patch?.newSource).toMatch(
      /^# @node: Cleaner {2}\[transform] {2}in=Load CSV\.df {2}out=clean_df\nclean_df = df\.dropna\(\)/,
    );
    expect(engine.getGraph().nodes[`${TWO_NODE_PATH}::2`]?.name).toBe("Cleaner");
  });

  it("cascades to same-notebook refs and rewrites the affected wire", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    const cells = toNotebookCells(twoNode);
    await engine.ingestNotebook(TWO_NODE_PATH, cells, 100);

    await engine.renameNode(`${TWO_NODE_PATH}::1`, "Loader", 200);

    // Two patches: the renamed cell (idx 1) and the downstream ref-bearing cell (idx 2).
    expect(adapter.patches).toHaveLength(2);
    expect(adapter.patches.map((p) => p.cellIndex).sort()).toEqual([1, 2]);

    const filter = engine.getGraph().nodes[`${TWO_NODE_PATH}::2`];
    expect(filter?.inputs).toEqual(["Loader.df"]);

    const wires = Object.values(engine.getGraph().wires);
    expect(wires).toHaveLength(1);
    expect(wires[0]?.targetPort).toBe("Loader.df");
  });

  it("cascades a rename to cross-notebook qualified refs", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    const cellsA = toNotebookCells(crossA);
    const cellsB = toNotebookCells(crossB);
    // A's alias defaults to its stem "a"; B references it via `a:Load CSV.df`.
    await engine.ingestNotebook(A_PATH, cellsA, 100);
    await engine.ingestNotebook(B_PATH, cellsB, 100);
    expect(Object.keys(engine.getGraph().wires)).toHaveLength(1);

    await engine.renameNode(`${A_PATH}::0`, "Loader", 200);

    // Both A's cell and B's referencing cell get patched.
    expect(adapter.patches.map((p) => p.notebookPath).sort()).toEqual([A_PATH, B_PATH]);
    const bPatch = adapter.patches.find((p) => p.notebookPath === B_PATH);
    expect(bPatch?.newSource).toContain("in=a:Loader.df");

    // B's ref now points at the renamed node, so the cross-notebook wire survives.
    expect(engine.getGraph().nodes[`${B_PATH}::0`]?.inputs).toEqual(["a:Loader.df"]);
    expect(Object.keys(engine.getGraph().wires)).toHaveLength(1);
  });

  it("throws when the node id is not found", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    await expect(engine.renameNode("bogus", "X", 1)).rejects.toThrow();
  });

  it("rejects invalid names", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    const cells = toNotebookCells(twoNode);
    await engine.ingestNotebook(TWO_NODE_PATH, cells, 100);
    await expect(engine.renameNode(`${TWO_NODE_PATH}::2`, "Bad[Name]", 200)).rejects.toThrow();
  });
});

describe("SyncEngine.createWire", () => {
  it("emits a CellPatch updating the target's marker and registers a new wire", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    const cells: NotebookCell[] = [
      { cellType: "code", source: "# @node: Source  [input]  out=df\n" },
      { cellType: "code", source: "# @node: Sink  [transform]  out=df\n" },
    ];
    await engine.ingestNotebook(TWO_NODE_PATH, cells, 100);

    await engine.createWire(`${TWO_NODE_PATH}::0`, "df", `${TWO_NODE_PATH}::1`, "ignored", 200);

    expect(adapter.patches).toHaveLength(1);
    expect(adapter.patches[0]?.cellIndex).toBe(1);
    expect(adapter.patches[0]?.newSource).toContain("in=Source.df");

    const wires = Object.values(engine.getGraph().wires);
    expect(wires).toHaveLength(1);
    expect(wires[0]?.targetPort).toBe("Source.df");
    expect(engine.getGraph().nodes[`${TWO_NODE_PATH}::1`]?.inputs).toEqual(["Source.df"]);
  });

  it("is a no-op when the target already has that input ref", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    const cells = toNotebookCells(twoNode);
    await engine.ingestNotebook(TWO_NODE_PATH, cells, 100);
    const wireCountBefore = Object.keys(engine.getGraph().wires).length;

    await engine.createWire(`${TWO_NODE_PATH}::1`, "df", `${TWO_NODE_PATH}::2`, "ignored", 200);

    expect(adapter.patches).toHaveLength(0);
    expect(Object.keys(engine.getGraph().wires)).toHaveLength(wireCountBefore);
  });
});

describe("SyncEngine.createNode", () => {
  it("emits an insert patch with marker, body, and metadata", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    const cells = toNotebookCells(twoNode);
    await engine.ingestNotebook(TWO_NODE_PATH, cells, 100);

    await engine.createNode(
      TWO_NODE_PATH,
      {
        name: "Parse CSV",
        tag: "input",
        outputs: ["df"],
        bodySource: "import pandas as pd\ndf = pd.read_csv('data.csv')\n",
        metadata: { notebookflow: { manifestId: "notebookflow.parse_csv" } },
      },
      200,
    );

    expect(adapter.patches).toHaveLength(1);
    expect(adapter.patches[0]).toMatchObject({
      notebookPath: TWO_NODE_PATH,
      cellIndex: cells.length,
      operation: "insert",
      cellType: "code",
      metadata: { notebookflow: { manifestId: "notebookflow.parse_csv" } },
    });
    expect(adapter.patches[0]?.newSource).toBe(
      "# @node: Parse CSV  [input]  out=df\nimport pandas as pd\ndf = pd.read_csv('data.csv')\n",
    );
  });

  it("dedupes a created node name within the same notebook", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    const cells = toNotebookCells(twoNode);
    await engine.ingestNotebook(TWO_NODE_PATH, cells, 100);

    await engine.createNode(
      TWO_NODE_PATH,
      { name: "Load CSV", tag: "input", outputs: ["df"], bodySource: "pass\n" },
      200,
    );

    expect(adapter.patches[0]?.newSource).toMatch(/^# @node: Load CSV 2 {2}\[input] {2}out=df\n/);
  });
});

describe("SyncEngine.updateNodeContents", () => {
  it("replaces the node body, carries metadata, and updates the in-memory node", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    const cells: NotebookCell[] = [
      {
        cellType: "code",
        source: "# @node: Source  [input]  out=df\ndf = load()\n",
        metadata: { notebookflow: { manifestId: "notebookflow.parse_csv" } },
      },
    ];
    await engine.ingestNotebook(TWO_NODE_PATH, cells, 100);

    await engine.updateNodeContents(
      `${TWO_NODE_PATH}::0`,
      {
        bodySource: "import pandas as pd\ndf = pd.read_csv('custom.csv')\n",
        metadata: {
          notebookflow: {
            manifestId: "notebookflow.parse_csv",
            config: { path: "custom.csv" },
          },
        },
      },
      200,
    );

    expect(adapter.patches).toHaveLength(1);
    expect(adapter.patches[0]).toMatchObject({
      notebookPath: TWO_NODE_PATH,
      cellIndex: 0,
      operation: "replace",
      metadata: {
        notebookflow: {
          manifestId: "notebookflow.parse_csv",
          config: { path: "custom.csv" },
        },
      },
    });
    expect(adapter.patches[0]?.newSource).toBe(
      "# @node: Source  [input]  out=df\nimport pandas as pd\ndf = pd.read_csv('custom.csv')\n",
    );
    expect(engine.getGraph().nodes[`${TWO_NODE_PATH}::0`]?.metadata).toEqual({
      notebookflow: {
        manifestId: "notebookflow.parse_csv",
        config: { path: "custom.csv" },
      },
    });
  });
});

describe("SyncEngine.setNodeInputs / setNodeOutputs", () => {
  it("rewrites the marker and rebuilds wires when inputs change", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    const cells: NotebookCell[] = [
      { cellType: "code", source: "# @node: Source  [input]  out=df\n" },
      { cellType: "code", source: "# @node: Sink  [transform]  out=clean\n" },
    ];
    await engine.ingestNotebook(TWO_NODE_PATH, cells, 100);
    expect(Object.keys(engine.getGraph().wires)).toHaveLength(0);

    await engine.setNodeInputs(`${TWO_NODE_PATH}::1`, ["Source.df"], 200);

    expect(adapter.patches[0]?.cellIndex).toBe(1);
    expect(adapter.patches[0]?.newSource).toContain("in=Source.df");
    const wires = Object.values(engine.getGraph().wires);
    expect(wires).toHaveLength(1);
    expect(wires[0]?.targetPort).toBe("Source.df");
    expect(engine.getGraph().nodes[`${TWO_NODE_PATH}::1`]?.inputs).toEqual(["Source.df"]);
  });

  it("drops a downstream wire when the referenced output is removed", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    const cells = toNotebookCells(twoNode);
    await engine.ingestNotebook(TWO_NODE_PATH, cells, 100);
    expect(Object.keys(engine.getGraph().wires)).toHaveLength(1);

    await engine.setNodeOutputs(`${TWO_NODE_PATH}::1`, [], 200);

    expect(adapter.patches[0]?.newSource).not.toContain("out=");
    expect(Object.keys(engine.getGraph().wires)).toHaveLength(0);
    expect(engine.getGraph().nodes[`${TWO_NODE_PATH}::1`]?.outputs).toEqual([]);
  });

  it("dedupes and rejects malformed refs", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    const cells: NotebookCell[] = [
      { cellType: "code", source: "# @node: Source  [input]  out=df\n" },
      { cellType: "code", source: "# @node: Sink  [transform]\n" },
    ];
    await engine.ingestNotebook(TWO_NODE_PATH, cells, 100);

    await engine.setNodeInputs(`${TWO_NODE_PATH}::1`, ["Source.df", "Source.df"], 200);
    expect(engine.getGraph().nodes[`${TWO_NODE_PATH}::1`]?.inputs).toEqual(["Source.df"]);

    await expect(engine.setNodeInputs(`${TWO_NODE_PATH}::1`, ["nope"], 300)).rejects.toThrow();
    await expect(engine.setNodeOutputs(`${TWO_NODE_PATH}::1`, ["Bad Port"], 300)).rejects.toThrow();
  });
});

describe("SyncEngine.getGraph", () => {
  it("returns a defensive copy that does not share state with the engine", async () => {
    const adapter = recordingAdapter();
    const engine = new SyncEngine(adapter.options);
    const cells = toNotebookCells(twoNode);
    await engine.ingestNotebook(TWO_NODE_PATH, cells, 100);

    const snapshot = engine.getGraph();
    Reflect.deleteProperty(snapshot.nodes, `${TWO_NODE_PATH}::1`);
    expect(engine.getGraph().nodes[`${TWO_NODE_PATH}::1`]).toBeDefined();
  });
});
