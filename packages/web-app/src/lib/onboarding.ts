/**
 * First-run onboarding — the "seen" flag, the guided-tour step list, and the
 * pure geometry helpers behind the spotlight overlay (spotlight rect padding,
 * card placement with viewport flipping). Everything here is DOM-free so it
 * can be unit-tested in plain Node; the components in components/onboarding/
 * feed it real getBoundingClientRect values.
 */

/** localStorage flag — present once the user finished or skipped onboarding. */
export const ONBOARDING_STORAGE_KEY = "nf.onboarding.v1";

/** The subset of the Storage API we touch (injectable for tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Whether onboarding has already been seen. Errs on the side of `true` when
 * storage is unavailable (private mode, quota) so a broken storage never traps
 * the user in a welcome loop on every load.
 */
export function hasSeenOnboarding(storage: StorageLike | null = defaultStorage()): boolean {
  if (storage === null) {
    return true;
  }
  try {
    return storage.getItem(ONBOARDING_STORAGE_KEY) !== null;
  } catch {
    return true;
  }
}

export function markOnboardingSeen(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(ONBOARDING_STORAGE_KEY, new Date().toISOString());
  } catch {
    // best-effort persistence
  }
}

export function clearOnboardingSeen(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(ONBOARDING_STORAGE_KEY);
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Tour steps

export type TourStepId = "files" | "cells" | "canvas" | "run" | "ask";
export type TourPlacement = "top" | "bottom" | "left" | "right";

export interface TourStep {
  id: TourStepId;
  /** Value of the `data-tour` attribute the spotlight targets. */
  target: TourStepId;
  /** Preferred card side relative to the spotlight; flips if it won't fit. */
  placement: TourPlacement;
}

/**
 * The five tour stops, in order. `id` doubles as the i18n key segment
 * (`onboarding.steps.<id>.title` / `.body`) and the `data-tour` target.
 * Typed as a non-empty tuple so `TOUR_STEPS[0]` needs no undefined-guard.
 */
export const TOUR_STEPS: readonly [TourStep, ...TourStep[]] = [
  { id: "files", target: "files", placement: "right" },
  { id: "cells", target: "cells", placement: "right" },
  { id: "canvas", target: "canvas", placement: "left" },
  { id: "run", target: "run", placement: "bottom" },
  { id: "ask", target: "ask", placement: "bottom" },
];

// ---------------------------------------------------------------------------
// Spotlight / card geometry (pure)

export interface TourRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Breathing room between the target's bounding box and the spotlight ring. */
export const SPOTLIGHT_PADDING = 8;
/** Gap between the spotlight edge and the floating card. */
export const CARD_GAP = 16;
/** Minimum distance the card keeps from every viewport edge. */
export const VIEWPORT_MARGIN = 12;

function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max < min ? min : max);
}

/**
 * Expand the target rect by `padding`, then intersect with the viewport (with
 * a hairline inset so the 1px ring never renders offscreen).
 */
export function computeSpotlightRect(
  target: TourRect,
  viewport: Size,
  padding: number = SPOTLIGHT_PADDING,
): TourRect {
  const inset = 2;
  const left = Math.max(target.left - padding, inset);
  const top = Math.max(target.top - padding, inset);
  const right = Math.min(target.left + target.width + padding, viewport.width - inset);
  const bottom = Math.min(target.top + target.height + padding, viewport.height - inset);
  return {
    left,
    top,
    width: Math.max(right - left, 0),
    height: Math.max(bottom - top, 0),
  };
}

function oppositeOf(placement: TourPlacement): TourPlacement {
  switch (placement) {
    case "left":
      return "right";
    case "right":
      return "left";
    case "top":
      return "bottom";
    case "bottom":
      return "top";
  }
}

function positionFor(
  side: TourPlacement,
  spotlight: TourRect,
  card: Size,
  gap: number,
): { top: number; left: number } {
  const centerX = spotlight.left + spotlight.width / 2 - card.width / 2;
  const centerY = spotlight.top + spotlight.height / 2 - card.height / 2;
  switch (side) {
    case "right":
      return { left: spotlight.left + spotlight.width + gap, top: centerY };
    case "left":
      return { left: spotlight.left - gap - card.width, top: centerY };
    case "bottom":
      return { left: centerX, top: spotlight.top + spotlight.height + gap };
    case "top":
      return { left: centerX, top: spotlight.top - gap - card.height };
  }
}

function fits(
  side: TourPlacement,
  spotlight: TourRect,
  card: Size,
  viewport: Size,
  gap: number,
  margin: number,
): boolean {
  switch (side) {
    case "right":
      return spotlight.left + spotlight.width + gap + card.width <= viewport.width - margin;
    case "left":
      return spotlight.left - gap - card.width >= margin;
    case "bottom":
      return spotlight.top + spotlight.height + gap + card.height <= viewport.height - margin;
    case "top":
      return spotlight.top - gap - card.height >= margin;
  }
}

/**
 * Place the floating card adjacent to the spotlight. Tries the preferred side,
 * then its opposite, then the remaining two; the cross axis is always clamped
 * into the viewport. Falls back to viewport-centered when nothing fits.
 */
export function computeCardPlacement(
  spotlight: TourRect,
  card: Size,
  viewport: Size,
  preferred: TourPlacement,
  gap: number = CARD_GAP,
  margin: number = VIEWPORT_MARGIN,
): { top: number; left: number; side: TourPlacement | "center" } {
  const opposite = oppositeOf(preferred);
  const rest = (["right", "left", "bottom", "top"] as const).filter(
    (side) => side !== preferred && side !== opposite,
  );
  for (const side of [preferred, opposite, ...rest]) {
    if (!fits(side, spotlight, card, viewport, gap, margin)) {
      continue;
    }
    const pos = positionFor(side, spotlight, card, gap);
    return {
      left: clampValue(pos.left, margin, viewport.width - card.width - margin),
      top: clampValue(pos.top, margin, viewport.height - card.height - margin),
      side,
    };
  }
  return {
    left: clampValue((viewport.width - card.width) / 2, margin, viewport.width),
    top: clampValue((viewport.height - card.height) / 2, margin, viewport.height),
    side: "center",
  };
}

/** Shallow rect equality — used to skip no-op re-measures. */
export function rectsEqual(a: TourRect | null, b: TourRect | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}
