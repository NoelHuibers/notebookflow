/**
 * useTour — the spotlight tour's state machine. Owns the current step index,
 * measures the step's `[data-tour]` target (on step change, on window resize,
 * plus one delayed settle pass for late layout), and drives the keyboard
 * protocol: ←/→/Enter navigate, Esc skips. While the tour is active every
 * other key is swallowed in the capture phase so the app's global shortcuts
 * (⌘K, ?, m, Esc-collapses-sidebar) can't fire underneath the overlay.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { rectsEqual, TOUR_STEPS, type TourRect, type TourStep } from "@/lib/onboarding";

export interface UseTourOptions {
  /**
   * Called right before a step is measured — the App uses it to expand any
   * collapsed pane the step is about to spotlight.
   */
  onBeforeStep?: ((step: TourStep) => void) | undefined;
  /** Called once, when the tour ends. `completed` is false for skips. */
  onClose: (completed: boolean) => void;
}

export interface TourState {
  stepIndex: number;
  step: TourStep;
  total: number;
  isFirst: boolean;
  isLast: boolean;
  /** Viewport rect of the current step's target; null until measured. */
  targetRect: TourRect | null;
  next: () => void;
  back: () => void;
  skip: () => void;
}

function measureTarget(target: TourStep["target"]): TourRect | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (el === null) {
    return null;
  }
  const rect = el.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

export function useTour({ onBeforeStep, onClose }: UseTourOptions): TourState {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TourRect | null>(null);
  // The mount below must observe prop changes without re-running; refs keep
  // the effect stable while the callbacks stay fresh.
  const onBeforeStepRef = useRef(onBeforeStep);
  onBeforeStepRef.current = onBeforeStep;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closedRef = useRef(false);
  // Mirror of stepIndex so next() can decide "advance vs finish" without
  // side effects inside a setState updater (updaters must stay pure).
  const stepIndexRef = useRef(0);
  stepIndexRef.current = stepIndex;

  // TOUR_STEPS is a non-empty tuple, so the fallback needs no further guard.
  const step: TourStep = TOUR_STEPS[stepIndex] ?? TOUR_STEPS[0];
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  const close = useCallback((completed: boolean): void => {
    if (closedRef.current) {
      return;
    }
    closedRef.current = true;
    onCloseRef.current(completed);
  }, []);

  const next = useCallback((): void => {
    if (stepIndexRef.current >= TOUR_STEPS.length - 1) {
      close(true);
      return;
    }
    setStepIndex((current) => Math.min(current + 1, TOUR_STEPS.length - 1));
  }, [close]);

  const back = useCallback((): void => {
    setStepIndex((current) => Math.max(current - 1, 0));
  }, []);

  const skip = useCallback((): void => {
    close(false);
  }, [close]);

  // Measure the step's target. onBeforeStep may expand a collapsed pane
  // (a React state change), so the first measurement waits two frames for the
  // re-render + layout to land; a settle pass 300ms later catches anything
  // slower (fonts, scroll-area layout). Resize re-measures for free.
  useEffect(() => {
    onBeforeStepRef.current?.(step);
    let frame1 = 0;
    let frame2 = 0;
    const applyMeasure = (): void => {
      const rect = measureTarget(step.target);
      setTargetRect((current) => (rectsEqual(current, rect) ? current : rect));
    };
    frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(applyMeasure);
    });
    const settle = window.setTimeout(applyMeasure, 300);
    window.addEventListener("resize", applyMeasure);
    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
      window.clearTimeout(settle);
      window.removeEventListener("resize", applyMeasure);
    };
  }, [step]);

  // Keyboard protocol, capture phase on window so it wins over the app's
  // document-level shortcuts. Tab is left alone (focus must keep working);
  // everything else stops propagating while the tour is up.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Tab") {
        return;
      }
      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      } else if (event.key === "Escape") {
        event.preventDefault();
        skip();
      }
      event.stopPropagation();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [next, back, skip]);

  return {
    stepIndex,
    step,
    total: TOUR_STEPS.length,
    isFirst: stepIndex === 0,
    isLast,
    targetRect,
    next,
    back,
    skip,
  };
}
