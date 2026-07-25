/**
 * TourOverlay — the spotlight tour surface. A portal above everything
 * (z-[100], above the app's z-50 dialogs) with:
 *
 * - a spotlight: one rounded div whose enormous box-shadow dims the rest of
 *   the screen, leaving a real cutout over the step's `[data-tour]` target,
 *   ringed in teal with a soft outer glow. Position + size tween between
 *   steps (GSAP power3, ~0.45s).
 * - a floating glass card adjacent to the spotlight (preferred side per step,
 *   auto-flips to stay in the viewport — geometry in lib/onboarding.ts), with
 *   crossfading step content, animated progress dots, and Back / Next / Skip.
 *
 * GSAP loads via dynamic import inside an effect (the established SSR-safe
 * pattern from LandingHero); until it lands — and always under
 * prefers-reduced-motion — positions are applied instantly.
 *
 * The overlay intercepts all pointer events; the backdrop deliberately does
 * nothing on click. Keyboard handling lives in useTour.
 */

import { ArrowLeft, ArrowRight } from "lucide-react";
import type { CSSProperties, ReactElement } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useReducedMotion } from "@/components/landing/useReducedMotion";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import {
  computeCardPlacement,
  computeSpotlightRect,
  TOUR_STEPS,
  type TourRect,
  type TourStep,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import { useTour } from "./useTour";

type GsapCore = typeof import("gsap")["gsap"];

interface TourOverlayProps {
  /** Expand collapsed panes before a step is spotlighted. */
  onBeforeStep?: (step: TourStep) => void;
  /** Fired once when the tour ends (finished or skipped). */
  onClose: (completed: boolean) => void;
}

/** Spotlight ring + glow + full-screen scrim, all as one box-shadow stack. */
const SPOTLIGHT_SHADOW = [
  "0 0 0 1px color-mix(in srgb, var(--primary) 85%, transparent)",
  "0 0 24px 2px color-mix(in srgb, var(--primary) 30%, transparent)",
  "0 0 0 9999px color-mix(in srgb, var(--background) 82%, transparent)",
].join(", ");

const spotlightStyle: CSSProperties = {
  boxShadow: SPOTLIGHT_SHADOW,
  // Seeded offscreen-ish (a zero-size dot at the viewport center); the first
  // layout pass positions it for real before paint.
  top: "50%",
  left: "50%",
  width: 0,
  height: 0,
};

export function TourOverlay({ onBeforeStep, onClose }: TourOverlayProps): ReactElement {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const tour = useTour({ onBeforeStep, onClose });

  const spotRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const gsapRef = useRef<GsapCore | null>(null);
  const positionedRef = useRef(false);
  const prevRenderedRef = useRef(0);
  // The step whose title/body the card currently shows. Trails tour.stepIndex
  // by one crossfade: old content fades out, this flips, new content fades in.
  const [renderedIndex, setRenderedIndex] = useState(0);
  const [gsapReady, setGsapReady] = useState(false);

  // SSR-safe GSAP load (App is a client island, but keep the module out of
  // the server graph anyway — same pattern as LandingHero).
  useEffect(() => {
    let cancelled = false;
    void import("gsap").then(({ gsap }) => {
      if (!cancelled) {
        gsapRef.current = gsap;
        setGsapReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Content crossfade, phase 1: fade the old step's text out, then swap.
  useEffect(() => {
    if (tour.stepIndex === renderedIndex) {
      return;
    }
    const gsap = gsapRef.current;
    const content = contentRef.current;
    if (reduced || gsap === null || content === null) {
      setRenderedIndex(tour.stepIndex);
      return;
    }
    const target = tour.stepIndex;
    gsap.killTweensOf(content);
    gsap.to(content, {
      opacity: 0,
      y: -4,
      duration: 0.15,
      ease: "power2.in",
      onComplete: () => {
        setRenderedIndex(target);
      },
    });
  }, [tour.stepIndex, renderedIndex, reduced]);

  // Content crossfade, phase 2: the new step's text rises in.
  useLayoutEffect(() => {
    const changed = prevRenderedRef.current !== renderedIndex;
    prevRenderedRef.current = renderedIndex;
    const gsap = gsapRef.current;
    const content = contentRef.current;
    if (!changed || reduced || gsap === null || content === null) {
      return;
    }
    gsap.killTweensOf(content);
    gsap.fromTo(
      content,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" },
    );
  }, [renderedIndex, reduced]);

  // Position spotlight + card. First pass applies instantly (pre-paint, so
  // there is no flash); subsequent passes tween. Re-runs when the measured
  // target rect changes (step change / resize / settle pass) and when the
  // rendered content flips (the card's height may have changed).
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderedIndex/gsapReady re-run the measurement on card-size / engine changes without being read directly
  useLayoutEffect(() => {
    const spot = spotRef.current;
    const card = cardRef.current;
    if (spot === null || card === null) {
      return;
    }
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const fallback: TourRect = {
      top: viewport.height / 2,
      left: viewport.width / 2,
      width: 0,
      height: 0,
    };
    const spotRect =
      tour.targetRect === null ? fallback : computeSpotlightRect(tour.targetRect, viewport);
    const cardSize = { width: card.offsetWidth, height: card.offsetHeight };
    const placed = computeCardPlacement(spotRect, cardSize, viewport, tour.step.placement);

    const spotVars = {
      top: spotRect.top,
      left: spotRect.left,
      width: spotRect.width,
      height: spotRect.height,
    };
    const cardVars = { top: placed.top, left: placed.left };
    const gsap = gsapRef.current;

    if (!positionedRef.current || reduced || gsap === null) {
      spot.style.top = `${String(spotVars.top)}px`;
      spot.style.left = `${String(spotVars.left)}px`;
      spot.style.width = `${String(spotVars.width)}px`;
      spot.style.height = `${String(spotVars.height)}px`;
      card.style.top = `${String(cardVars.top)}px`;
      card.style.left = `${String(cardVars.left)}px`;
      positionedRef.current = true;
      return;
    }
    // overwrite:"auto" kills in-flight position tweens (rapid stepping,
    // resize storms) instead of letting them fight over the same props.
    gsap.to(spot, { ...spotVars, duration: 0.45, ease: "power3.inOut", overwrite: "auto" });
    gsap.to(card, { ...cardVars, duration: 0.45, ease: "power3.inOut", overwrite: "auto" });
  }, [tour.targetRect, tour.step.placement, renderedIndex, reduced, gsapReady]);

  const renderedStep = TOUR_STEPS[renderedIndex] ?? TOUR_STEPS[0];

  return createPortal(
    <div
      className="fixed inset-0 z-[100] overflow-hidden motion-safe:animate-in motion-safe:fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={t("onboarding.tour.stepLabel")}
    >
      {/* Spotlight — the box-shadow scrim + teal ring. Inert like the rest of
          the backdrop: clicking anywhere outside the card does nothing. */}
      <div ref={spotRef} className="absolute rounded-xl" style={spotlightStyle} />

      {/* Floating step card */}
      <div
        ref={cardRef}
        className="absolute w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-border bg-card/90 p-5 shadow-2xl backdrop-blur-md"
      >
        <Button
          variant="ghost"
          size="sm"
          className="absolute right-2.5 top-2.5 h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={tour.skip}
        >
          {t("onboarding.tour.skip")}
        </Button>

        <div ref={contentRef}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            {t("onboarding.tour.progress", {
              current: renderedIndex + 1,
              total: tour.total,
            })}
          </p>
          <h2 className="mt-2 text-base font-semibold tracking-tight">
            {t(`onboarding.steps.${renderedStep.id}.title`)}
          </h2>
          {/* Progress label + title stay mono (tool identity, tied to the app the
              tour spotlights); the reading body opts into Plex Sans (issue #50). */}
          <p className="mt-1.5 font-sans text-[13px] leading-relaxed text-muted-foreground">
            {t(`onboarding.steps.${renderedStep.id}.body`)}
          </p>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          {/* Progress dots — the active one stretches into a teal pill. */}
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {TOUR_STEPS.map((step, index) => (
              <span
                key={step.id}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300 ease-out motion-reduce:transition-none",
                  index === tour.stepIndex
                    ? "w-6 bg-primary"
                    : index < tour.stepIndex
                      ? "w-1.5 bg-primary/50"
                      : "w-1.5 bg-muted-foreground/30",
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={tour.back}
              disabled={tour.isFirst}
              className={cn(tour.isFirst && "invisible")}
            >
              <ArrowLeft className="mr-1 size-3.5" />
              {t("onboarding.tour.back")}
            </Button>
            <Button variant="default" size="sm" onClick={tour.next}>
              {tour.isLast ? t("onboarding.tour.finish") : t("onboarding.tour.next")}
              {!tour.isLast && <ArrowRight className="ml-1 size-3.5" />}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
