/**
 * WelcomeCard — the first-run welcome moment. A full-viewport portal (deep
 * blurred backdrop) with a centered glass card: wordmark, one value line, and
 * "Take the tour" / "Skip for now".
 *
 * Entrance: the card fades in with a subtle rise + scale-from-0.96 (GSAP,
 * ~0.5s expo), then the wordmark → title → body → buttons cascade in with a
 * short stagger. GSAP is dynamically imported (SSR-safe, matching
 * LandingHero); under prefers-reduced-motion everything renders instantly.
 *
 * While the welcome is up, app-level shortcuts are swallowed (capture phase);
 * Tab / Enter / Space stay native so the buttons remain keyboard-operable,
 * and Esc skips.
 */

import { ArrowRight } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { LogoMark } from "@/components/Logo";
import { useReducedMotion } from "@/components/landing/useReducedMotion";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

interface WelcomeCardProps {
  onTakeTour: () => void;
  onSkip: () => void;
}

export function WelcomeCard({ onTakeTour, onSkip }: WelcomeCardProps): ReactElement {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const onSkipRef = useRef(onSkip);
  onSkipRef.current = onSkip;

  // Entrance timeline. The card is pre-hidden inline (only when motion is
  // allowed) so there is no flash between mount and the dynamic import
  // resolving; if GSAP ever fails to load, the catch reveals the card.
  useEffect(() => {
    if (reduced) {
      return;
    }
    let cancelled = false;
    let timeline: { kill: () => void } | null = null;
    void import("gsap")
      .then(({ gsap }) => {
        const card = cardRef.current;
        if (cancelled || card === null) {
          return;
        }
        const items = card.querySelectorAll("[data-welcome-item]");
        gsap.set(items, { opacity: 0, y: 10 });
        const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
        tl.fromTo(
          card,
          { opacity: 0, y: 18, scale: 0.96 },
          { opacity: 1, y: 0, scale: 1, duration: 0.5 },
        );
        tl.to(items, { opacity: 1, y: 0, duration: 0.45, stagger: 0.07 }, 0.16);
        timeline = tl;
      })
      .catch(() => {
        const card = cardRef.current;
        if (card !== null) {
          card.style.opacity = "1";
        }
      });
    return () => {
      cancelled = true;
      timeline?.kill();
    };
  }, [reduced]);

  // Esc skips; every other key except Tab / Enter / Space is swallowed so the
  // app's global shortcuts (⌘K, ?, m…) can't fire underneath the welcome.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Tab" || event.key === "Enter" || event.key === " ") {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onSkipRef.current();
      }
      event.stopPropagation();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 p-6 backdrop-blur motion-safe:animate-in motion-safe:fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={t("onboarding.welcome.badge")}
    >
      <div
        ref={cardRef}
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card/90 p-8 shadow-2xl backdrop-blur-xl"
        style={reduced ? undefined : { opacity: 0 }}
      >
        {/* Soft teal wash along the card's top edge */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-28"
          style={{
            background:
              "radial-gradient(24rem 8rem at 50% -20%, color-mix(in srgb, var(--primary) 16%, transparent), transparent 70%)",
          }}
        />

        <div data-welcome-item className="relative flex items-center gap-2.5">
          <LogoMark className="size-6 text-primary" />
          <span className="text-sm font-semibold tracking-tight">NotebookFlow</span>
        </div>

        <h2
          data-welcome-item
          className="relative mt-5 text-balance text-2xl font-bold leading-tight tracking-tight"
        >
          {t("onboarding.welcome.title")}
        </h2>

        <p
          data-welcome-item
          className="relative mt-3 text-pretty text-sm leading-relaxed text-muted-foreground"
        >
          {t("onboarding.welcome.body")}
        </p>

        <div data-welcome-item className="relative mt-7 flex flex-wrap items-center gap-3">
          {/* autoFocus: the primary CTA of a modal welcome should own focus on open */}
          <Button autoFocus onClick={onTakeTour}>
            {t("onboarding.welcome.takeTour")}
            <ArrowRight className="ml-1 size-4" />
          </Button>
          <Button variant="ghost" onClick={onSkip}>
            {t("onboarding.welcome.skip")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
