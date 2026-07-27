import type { Node } from "reactflow";
import { describe, expect, it, vi } from "vitest";

import { deepEqualValue, reconcileNodes } from "./nodeReconcile";

function notebookNode(id: string, overlay: Record<string, unknown> = {}): Node {
  return {
    id,
    type: "notebook",
    parentNode: "group:g",
    extent: "parent",
    position: { x: 0, y: 0 },
    draggable: false,
    selectable: true,
    data: {
      id,
      name: id,
      tag: "transform",
      inputs: ["a"],
      outputs: ["b"],
      cellIndices: [0],
      inputSuggestions: ["x.y"],
      outputSuggestions: ["b"],
      runtimeState: "idle",
      portPlacement: "stacked",
      ...overlay,
    },
  };
}

describe("deepEqualValue", () => {
  it("treats value-equal nested structures as equal", () => {
    expect(deepEqualValue(notebookNode("n1"), notebookNode("n1"))).toBe(true);
  });

  it("detects a changed overlay field", () => {
    const a = notebookNode("n1", { runtimeState: "idle" });
    const b = notebookNode("n1", { runtimeState: "running" });
    expect(deepEqualValue(a, b)).toBe(false);
  });

  it("compares arrays element-wise, including a fresh array reference", () => {
    expect(deepEqualValue(["b"], ["b"])).toBe(true);
    expect(deepEqualValue(["b"], ["b", "c"])).toBe(false);
    expect(deepEqualValue(["b"], ["c"])).toBe(false);
  });

  it("treats same-reference functions as equal and different ones as not", () => {
    const fn = vi.fn();
    expect(deepEqualValue({ onRename: fn }, { onRename: fn })).toBe(true);
    expect(deepEqualValue({ onRename: () => {} }, { onRename: () => {} })).toBe(false);
  });

  it("distinguishes arrays from plain objects and differing key sets", () => {
    expect(deepEqualValue([], {})).toBe(false);
    expect(deepEqualValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqualValue({ a: 1 }, { b: 1 })).toBe(false);
  });
});

describe("reconcileNodes", () => {
  it("reuses the previous object reference for unchanged nodes", () => {
    const prev = [notebookNode("n1"), notebookNode("n2"), notebookNode("n3")];
    // Only n2's runtime overlay changed (a fresh array from buildNodes).
    const next = [
      notebookNode("n1"),
      notebookNode("n2", { runtimeState: "running" }),
      notebookNode("n3"),
    ];
    const result = reconcileNodes(prev, next);
    // Unchanged nodes keep prior identity...
    expect(result[0]).toBe(prev[0]);
    expect(result[2]).toBe(prev[2]);
    // ...the changed node is the freshly-built object.
    expect(result[1]).toBe(next[1]);
  });

  it("counts only the changed node as rebuilt on a single runtime event", () => {
    const n = 50;
    const prev = Array.from({ length: n }, (_, i) => notebookNode(`n${String(i)}`));
    const next = prev.map((_node, i) =>
      i === 7 ? notebookNode("n7", { runtimeState: "running" }) : notebookNode(`n${String(i)}`),
    );
    const result = reconcileNodes(prev, next);
    const rebuilt = result.filter((node, i) => node !== prev[i]).length;
    expect(rebuilt).toBe(1);
  });

  it("produces a value-identical array to the fresh build", () => {
    const prev = [notebookNode("n1"), notebookNode("n2")];
    const next = [notebookNode("n1"), notebookNode("n2", { runtimeState: "ok" })];
    const result = reconcileNodes(prev, next);
    expect(result).toHaveLength(next.length);
    result.forEach((node, i) => {
      expect(deepEqualValue(node, next[i])).toBe(true);
      expect(node.id).toBe(next[i]?.id);
    });
  });

  it("returns the fresh array when there is no prior build", () => {
    const next = [notebookNode("n1")];
    expect(reconcileNodes([], next)).toBe(next);
  });

  it("returns the fresh array when every node changed", () => {
    const prev = [notebookNode("n1"), notebookNode("n2")];
    const next = [
      notebookNode("n1", { runtimeState: "ok" }),
      notebookNode("n2", { runtimeState: "error" }),
    ];
    expect(reconcileNodes(prev, next)).toBe(next);
  });

  it("handles added and removed nodes without reusing stale ids", () => {
    const prev = [notebookNode("n1"), notebookNode("n2")];
    const next = [notebookNode("n1"), notebookNode("n3")];
    const result = reconcileNodes(prev, next);
    expect(result[0]).toBe(prev[0]);
    expect(result[1]).toBe(next[1]);
    expect(result.map((node) => node.id)).toEqual(["n1", "n3"]);
  });
});
