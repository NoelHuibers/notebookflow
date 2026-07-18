import { describe, expect, it } from "vitest";

import { defaultCanvasLabels, defaultNodeConfigLabels } from "./labels";
import { canvasLocale, deCanvasLabels, deNodeConfigLabels } from "./labels.de";

/** Every `{token}` placeholder occurring in a string. */
function placeholders(value: string): string[] {
  return value.match(/\{[a-zA-Z]+\}/g) ?? [];
}

describe("German canvas labels", () => {
  it("covers exactly the CanvasLabels keys", () => {
    expect(Object.keys(deCanvasLabels).sort()).toEqual(Object.keys(defaultCanvasLabels).sort());
  });

  it("covers exactly the NodeConfigLabels keys", () => {
    expect(Object.keys(deNodeConfigLabels).sort()).toEqual(
      Object.keys(defaultNodeConfigLabels).sort(),
    );
  });

  it("preserves every placeholder from the English defaults", () => {
    for (const [key, enValue] of Object.entries(defaultCanvasLabels)) {
      const deValue = deCanvasLabels[key as keyof typeof deCanvasLabels];
      for (const token of placeholders(enValue)) {
        expect(deValue, `${key} should contain ${token}`).toContain(token);
      }
    }
    for (const [key, enValue] of Object.entries(defaultNodeConfigLabels)) {
      const deValue = deNodeConfigLabels[key as keyof typeof deNodeConfigLabels];
      for (const token of placeholders(enValue)) {
        expect(deValue, `${key} should contain ${token}`).toContain(token);
      }
    }
  });
});

describe("canvasLocale", () => {
  it("maps German tags to de", () => {
    expect(canvasLocale("de")).toBe("de");
    expect(canvasLocale("de-AT")).toBe("de");
    expect(canvasLocale("DE")).toBe("de");
  });

  it("maps everything else to en", () => {
    expect(canvasLocale("en-US")).toBe("en");
    expect(canvasLocale("fr")).toBe("en");
    expect(canvasLocale("")).toBe("en");
    expect(canvasLocale(undefined)).toBe("en");
    expect(canvasLocale(null)).toBe("en");
  });
});
