import { describe, expect, it } from "vitest";

import {
  clearOnboardingSeen,
  computeCardPlacement,
  computeSpotlightRect,
  hasSeenOnboarding,
  markOnboardingSeen,
  ONBOARDING_STORAGE_KEY,
  rectsEqual,
  SPOTLIGHT_PADDING,
  type StorageLike,
  TOUR_STEPS,
  type TourRect,
} from "./onboarding";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function throwingStorage(): StorageLike {
  return {
    getItem: () => {
      throw new Error("quota");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("quota");
    },
  };
}

describe("onboarding flag", () => {
  it("is unseen on a fresh storage", () => {
    expect(hasSeenOnboarding(memoryStorage())).toBe(false);
  });

  it("round-trips mark → seen → clear → unseen", () => {
    const storage = memoryStorage();
    markOnboardingSeen(storage);
    expect(storage.data.has(ONBOARDING_STORAGE_KEY)).toBe(true);
    expect(hasSeenOnboarding(storage)).toBe(true);
    clearOnboardingSeen(storage);
    expect(hasSeenOnboarding(storage)).toBe(false);
  });

  it("treats missing storage as seen (never traps the user in a loop)", () => {
    expect(hasSeenOnboarding(null)).toBe(true);
  });

  it("survives a throwing storage on every operation", () => {
    const storage = throwingStorage();
    expect(hasSeenOnboarding(storage)).toBe(true);
    expect(() => {
      markOnboardingSeen(storage);
    }).not.toThrow();
    expect(() => {
      clearOnboardingSeen(storage);
    }).not.toThrow();
  });
});

describe("TOUR_STEPS", () => {
  it("visits the five surfaces in the intended order", () => {
    expect(TOUR_STEPS.map((step) => step.id)).toEqual(["files", "cells", "canvas", "run", "ask"]);
  });

  it("uses the step id as its data-tour target", () => {
    for (const step of TOUR_STEPS) {
      expect(step.target).toBe(step.id);
    }
  });

  it("declares a valid preferred placement on every step", () => {
    for (const step of TOUR_STEPS) {
      expect(["top", "bottom", "left", "right"]).toContain(step.placement);
    }
  });

  it("has unique step ids", () => {
    const ids = TOUR_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

const viewport = { width: 1280, height: 800 };

describe("computeSpotlightRect", () => {
  it("pads the target on all sides", () => {
    const target: TourRect = { top: 100, left: 200, width: 300, height: 150 };
    const rect = computeSpotlightRect(target, viewport);
    expect(rect).toEqual({
      top: 100 - SPOTLIGHT_PADDING,
      left: 200 - SPOTLIGHT_PADDING,
      width: 300 + 2 * SPOTLIGHT_PADDING,
      height: 150 + 2 * SPOTLIGHT_PADDING,
    });
  });

  it("clamps to the viewport so the ring never renders offscreen", () => {
    const target: TourRect = { top: 0, left: 0, width: 1280, height: 800 };
    const rect = computeSpotlightRect(target, viewport);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.left + rect.width).toBeLessThanOrEqual(viewport.width);
    expect(rect.top + rect.height).toBeLessThanOrEqual(viewport.height);
  });

  it("never produces negative dimensions for degenerate targets", () => {
    const offscreen: TourRect = { top: -500, left: -500, width: 10, height: 10 };
    const rect = computeSpotlightRect(offscreen, viewport);
    expect(rect.width).toBeGreaterThanOrEqual(0);
    expect(rect.height).toBeGreaterThanOrEqual(0);
  });
});

describe("computeCardPlacement", () => {
  const card = { width: 384, height: 220 };

  it("uses the preferred side when it fits", () => {
    // A files-rail-like spotlight hugging the left edge; card prefers "right".
    const spotlight: TourRect = { top: 50, left: 0, width: 180, height: 700 };
    const placed = computeCardPlacement(spotlight, card, viewport, "right");
    expect(placed.side).toBe("right");
    expect(placed.left).toBe(180 + 16);
  });

  it("flips to the opposite side when the preferred side has no room", () => {
    // A sidebar-like spotlight hugging the right edge; "right" cannot fit.
    const spotlight: TourRect = { top: 50, left: 1000, width: 270, height: 700 };
    const placed = computeCardPlacement(spotlight, card, viewport, "right");
    expect(placed.side).toBe("left");
    expect(placed.left + card.width).toBeLessThanOrEqual(1000);
  });

  it("clamps the cross axis into the viewport", () => {
    // A header-button-like spotlight at the very top right; card below it.
    const spotlight: TourRect = { top: 4, left: 1150, width: 120, height: 36 };
    const placed = computeCardPlacement(spotlight, card, viewport, "bottom");
    expect(placed.side).toBe("bottom");
    expect(placed.left + card.width).toBeLessThanOrEqual(viewport.width - 12);
    expect(placed.left).toBeGreaterThanOrEqual(12);
  });

  it("falls back to a viewport-centered card when no side fits", () => {
    const spotlight: TourRect = { top: 0, left: 0, width: 1280, height: 800 };
    const placed = computeCardPlacement(spotlight, card, viewport, "left");
    expect(placed.side).toBe("center");
    expect(placed.left).toBe((viewport.width - card.width) / 2);
    expect(placed.top).toBe((viewport.height - card.height) / 2);
  });

  it("keeps the card inside the viewport on every step's preferred side", () => {
    const spotlights: Record<string, TourRect> = {
      files: { top: 45, left: 0, width: 176, height: 755 },
      cells: { top: 45, left: 176, width: 460, height: 560 },
      canvas: { top: 45, left: 646, width: 634, height: 560 },
      run: { top: 6, left: 1010, width: 110, height: 32 },
      ask: { top: 6, left: 905, width: 95, height: 32 },
    };
    for (const step of TOUR_STEPS) {
      const spotlight = spotlights[step.id];
      expect(spotlight).toBeDefined();
      if (spotlight === undefined) {
        continue;
      }
      const placed = computeCardPlacement(spotlight, card, viewport, step.placement);
      expect(placed.left).toBeGreaterThanOrEqual(12);
      expect(placed.top).toBeGreaterThanOrEqual(12);
      expect(placed.left + card.width).toBeLessThanOrEqual(viewport.width - 12);
      expect(placed.top + card.height).toBeLessThanOrEqual(viewport.height - 12);
    }
  });
});

describe("rectsEqual", () => {
  it("compares by value and tolerates nulls", () => {
    const a: TourRect = { top: 1, left: 2, width: 3, height: 4 };
    expect(rectsEqual(a, { ...a })).toBe(true);
    expect(rectsEqual(a, { ...a, width: 5 })).toBe(false);
    expect(rectsEqual(null, null)).toBe(true);
    expect(rectsEqual(a, null)).toBe(false);
  });
});
