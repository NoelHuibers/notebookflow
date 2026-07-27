import { describe, expect, it } from "vitest";

import { shouldRenderFullEditor } from "./cellVirtualization";

describe("shouldRenderFullEditor", () => {
  const near = (indices: number[]): Set<number> => new Set(indices);

  it("renders full editor for a near cell", () => {
    expect(shouldRenderFullEditor(2, { nearIndices: near([1, 2, 3]) })).toBe(true);
  });

  it("renders fallback for a far cell", () => {
    expect(shouldRenderFullEditor(9, { nearIndices: near([1, 2, 3]) })).toBe(false);
  });

  it("keeps the focused cell full even when it is far from the viewport", () => {
    expect(shouldRenderFullEditor(9, { nearIndices: near([1, 2]), focusedCellIndex: 9 })).toBe(
      true,
    );
  });

  it("keeps the streaming cell full even when it is far from the viewport", () => {
    expect(shouldRenderFullEditor(7, { nearIndices: near([0]), streamingCellIndex: 7 })).toBe(true);
  });

  it("does not treat a null focused/streaming index as index 0-ish match", () => {
    expect(
      shouldRenderFullEditor(0, {
        nearIndices: near([5]),
        focusedCellIndex: null,
        streamingCellIndex: null,
      }),
    ).toBe(false);
  });

  it("full when every cell is near (SSR/no-IntersectionObserver degrade case)", () => {
    const all = near([0, 1, 2, 3, 4]);
    for (const i of all) {
      expect(shouldRenderFullEditor(i, { nearIndices: all })).toBe(true);
    }
  });

  it("full when the cell is both near and focused", () => {
    expect(shouldRenderFullEditor(3, { nearIndices: near([3]), focusedCellIndex: 3 })).toBe(true);
  });

  it("fallback for an empty near set with no focus/streaming", () => {
    expect(shouldRenderFullEditor(4, { nearIndices: near([]) })).toBe(false);
  });
});
