import { describe, expect, it } from "vitest";

import {
  clampOptionalRatio,
  clampSidebarWidthValue,
  DIVIDER_SIZE_PX,
  MIN_CANVAS_BODY_WIDTH_PX,
  MIN_SIDEBAR_WIDTH_PX,
} from "./panels";

// Only clientWidth is read, so a plain object stands in for a real element.
function hostWithWidth(clientWidth: number): HTMLElement {
  return { clientWidth } as HTMLElement;
}

describe("clampOptionalRatio", () => {
  it("returns the fallback when the value is undefined", () => {
    expect(clampOptionalRatio(undefined, 42)).toBe(42);
  });

  it("passes through in-range values", () => {
    expect(clampOptionalRatio(55, 42)).toBe(55);
  });

  it("clamps to the 0..100 percent range", () => {
    expect(clampOptionalRatio(-10, 42)).toBe(0);
    expect(clampOptionalRatio(140, 42)).toBe(100);
  });
});

describe("clampSidebarWidthValue", () => {
  it("only enforces the minimum when no host is available", () => {
    expect(clampSidebarWidthValue(100, null)).toBe(MIN_SIDEBAR_WIDTH_PX);
    expect(clampSidebarWidthValue(900, null)).toBe(900);
  });

  it("clamps to the space the canvas body leaves free", () => {
    const host = hostWithWidth(1000);
    const maxWidth = 1000 - MIN_CANVAS_BODY_WIDTH_PX - DIVIDER_SIZE_PX;
    expect(clampSidebarWidthValue(900, host)).toBe(maxWidth);
    expect(clampSidebarWidthValue(100, host)).toBe(MIN_SIDEBAR_WIDTH_PX);
    expect(clampSidebarWidthValue(300, host)).toBe(300);
  });

  it("keeps the minimum width even when the host is too narrow", () => {
    expect(clampSidebarWidthValue(500, hostWithWidth(400))).toBe(MIN_SIDEBAR_WIDTH_PX);
  });
});
