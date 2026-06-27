import { describe, expect, it } from "vitest";

import type { GraphModel, NodeModel } from "../types";
import { collectInputRefs, collectOutputSuggestions } from "./portSuggestions";

function node(id: string, overrides: Partial<NodeModel> = {}): NodeModel {
  return {
    id,
    name: id,
    tag: "transform",
    inputs: [],
    outputs: [],
    cellIndices: [0],
    groupId: "nb",
    ...overrides,
  };
}

function graph(nodes: Record<string, NodeModel>): GraphModel {
  return {
    nodes,
    groups: {
      nb: {
        id: "nb",
        notebookPath: "nb",
        name: "nb",
        alias: "nb",
        nodeIds: Object.keys(nodes),
        collapsed: false,
      },
    },
    wires: {},
  };
}

describe("collectOutputSuggestions", () => {
  it("includes port names from declared inputs for passthrough cells", () => {
    const suggestions = collectOutputSuggestions(
      node("nb::1", { name: "Middle", inputs: ["Cell1.n"], outputs: [] }),
      {},
    );
    expect(suggestions).toEqual(["n"]);
  });

  it("merges declared outputs, input ports, and analyzed variables", () => {
    const suggestions = collectOutputSuggestions(
      node("nb::1", { name: "Middle", inputs: ["Cell1.n"], outputs: ["clean"] }),
      { "nb::1": ["extra"] },
    );
    expect(suggestions).toEqual(["clean", "extra", "n"]);
  });
});

describe("collectInputRefs", () => {
  it("includes declared upstream outputs even when absent from code", () => {
    const refs = collectInputRefs(
      graph({
        "nb::0": node("nb::0", { name: "Source", tag: "input", outputs: ["n"] }),
        "nb::2": node("nb::2", { name: "Sink" }),
      }),
      {},
      "nb::2",
    );
    expect(refs).toEqual(["Source.n"]);
  });

  it("lists every other node's declared outputs", () => {
    const refs = collectInputRefs(
      graph({
        "nb::0": node("nb::0", { name: "Cell1", tag: "input", outputs: ["n"] }),
        "nb::1": node("nb::1", { name: "Cell2", outputs: ["m"] }),
        "nb::2": node("nb::2", { name: "Cell3" }),
      }),
      {},
      "nb::2",
    );
    expect(refs).toEqual(["Cell1.n", "Cell2.m"]);
  });

  it("includes passthrough port names from upstream inputs", () => {
    const refs = collectInputRefs(
      graph({
        "nb::0": node("nb::0", { name: "Cell1", tag: "input", outputs: ["n"] }),
        "nb::1": node("nb::1", { name: "Cell2", inputs: ["Cell1.n"], outputs: [] }),
        "nb::2": node("nb::2", { name: "Cell3" }),
      }),
      {},
      "nb::2",
    );
    expect(refs).toEqual(["Cell1.n", "Cell2.n"]);
  });
});
