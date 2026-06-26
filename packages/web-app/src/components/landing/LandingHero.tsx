/**
 * LandingHero — the cinematic, scroll-scrubbed centrepiece.
 *
 * A pinned full-viewport stage. As the visitor scrolls, a GSAP timeline (pinned
 * + scrubbed) plays the product story over the GraphScene:
 *   1. hero notebook  →  2. cells lift into nodes + local wires draw  →
 *   3. a second notebook links in via a cross-notebook (purple, dashed) wire  →
 *   4. a run pulse lights the DAG up in topological order.
 *
 * SSR-safe: the markup (GraphScene at rest + the SEO <h1>/CTAs in caption 0) is
 * server-rendered; GSAP runs only in a client effect; the R3F backdrop is the
 * only piece gated behind <ClientOnly>. Under prefers-reduced-motion the whole
 * timeline is skipped and the static composed graph stands in.
 */
import { ClientOnly, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import {
  type CSSProperties,
  lazy,
  type ReactElement,
  type ReactNode,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { GraphScene } from "./GraphScene";
import { DESIGN_H, DESIGN_W, IDLE_DOT, RUN_OK, RUN_ORDER, RUN_TEAL } from "./graph-data";
import { useReducedMotion } from "./useReducedMotion";

// GSAP + ScrollTrigger are loaded via dynamic import() inside a client effect so
// they never enter the SSR module graph — `gsap/ScrollTrigger` has no Node-ESM
// named export and crashes the server bundle if statically imported.
const useIsoLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect;

// Three.js / R3F is ~285 kB gzip — keep it out of the initial landing payload
// and load it only on the client, after mount, when motion is allowed.
const AmbientBackdrop = lazy(() =>
  import("./AmbientBackdrop").then((m) => ({ default: m.AmbientBackdrop })),
);

const TEAL_GLOW = "rgba(45, 212, 191, 0.35)";

export function LandingHero(): ReactElement {
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const [dark, setDark] = useState(false);
  const [backdropPaused, setBackdropPaused] = useState(false);

  // Track the resolved theme (the .dark class on <html>) to tint the backdrop.
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // Pause the WebGL backdrop once the pinned stage scrolls out of view.
  useEffect(() => {
    const node = pinRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => setBackdropPaused(!entries[0]?.isIntersecting),
      { threshold: 0.01 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  // Arm the hero's initial state synchronously (pre-paint) so the first frame is
  // the hero, not the resting final-state graph — avoids a flash before the
  // (async) GSAP timeline takes over. Skipped under reduced motion.
  useIsoLayoutEffect(() => {
    if (reduced) return;
    const root = rootRef.current;
    if (!root) return;
    const setOpacity = (sel: string, value: string) => {
      for (const el of root.querySelectorAll<HTMLElement>(sel)) el.style.opacity = value;
    };
    setOpacity(".nf-source", "1");
    setOpacity(".nf-node", "0");
    setOpacity(".nf-port", "0");
    setOpacity(".nf-container", "0");
    setOpacity(".nf-pill", "0");
    setOpacity(".nf-wire", "0");
    setOpacity('.nf-cap[data-cap="1"], .nf-cap[data-cap="2"], .nf-cap[data-cap="3"]', "0");
    for (const el of root.querySelectorAll<HTMLElement>(".nf-bar")) {
      el.style.transform = "scaleY(0)";
      el.style.transformOrigin = "bottom";
    }
  }, [reduced]);

  // Load GSAP + ScrollTrigger on the client only, then build the pinned,
  // scrubbed timeline inside a gsap.context scoped to the section (auto-reverted
  // on cleanup / when reduced motion toggles).
  useEffect(() => {
    if (reduced) return;
    const root = rootRef.current;
    const pin = pinRef.current;
    if (!root || !pin) return;

    let ctx: { revert: () => void } | undefined;
    let onResize: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);

      ctx = gsap.context(() => {
        const q = gsap.utils.selector(root);

        // ---- Initial "hero" state -----------------------------------------
        // Source notebook centre stage; nodes tucked away.
        gsap.set(q(".nf-source"), { opacity: 1, scale: 1, y: 0 });
        gsap.set(q('.nf-node:not([data-node="forecast"])'), { opacity: 0, scale: 0.85, y: 24 });
        gsap.set(q('.nf-node[data-node="forecast"]'), { opacity: 0, scale: 0.85, y: 64 });
        gsap.set(q(".nf-port"), { opacity: 0 });
        gsap.set(q(".nf-container"), { opacity: 0, scale: 0.98 });
        gsap.set(q(".nf-pill"), { opacity: 0, y: 12 });
        gsap.set(q(".nf-bar"), { scaleY: 0, transformOrigin: "bottom" });
        gsap.set(q(".nf-status"), { backgroundColor: IDLE_DOT, scale: 1 });

        // Local wires: visible but drawn-on via strokeDashoffset. Cross wire:
        // opacity reveal + marching-ants flow (set up separately, below).
        gsap.set(q(".nf-wire-local"), { opacity: 1 });
        for (const path of q(".nf-wire-local") as unknown as SVGPathElement[]) {
          const len = path.getTotalLength();
          gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
        }
        gsap.set(q(".nf-wire-cross"), { opacity: 0 });

        // Captions: 0 visible (SSR hero), the rest hidden.
        gsap.set(q('.nf-cap[data-cap="1"], .nf-cap[data-cap="2"], .nf-cap[data-cap="3"]'), {
          opacity: 0,
          y: 16,
        });

        // ---- Master timeline (pinned + scrubbed) --------------------------
        const tl = gsap.timeline({
          defaults: { ease: "power2.out" },
          scrollTrigger: {
            trigger: pin,
            start: "top top",
            end: "+=3400",
            scrub: 0.6,
            pin,
            anticipatePin: 1,
          },
        });

        // Act 1 → 2: notebook recedes, cells lift into nodes, local wires draw.
        tl.to(q(".nf-scrollcue"), { opacity: 0, duration: 0.3 }, 0.1);
        tl.to(q('.nf-cap[data-cap="0"]'), { opacity: 0, y: -16, duration: 0.6 }, 0.4);
        tl.to(q(".nf-source"), { opacity: 0, scale: 0.6, y: -50, duration: 1 }, 0.4);
        tl.to(q('.nf-cap[data-cap="1"]'), { opacity: 1, y: 0, duration: 0.6 }, 0.7);
        tl.to(
          q('.nf-node:not([data-node="forecast"])'),
          { opacity: 1, scale: 1, y: 0, stagger: 0.16, duration: 0.9 },
          0.7,
        );
        tl.to(q(".nf-port"), { opacity: 1, duration: 0.5 }, 1.3);
        tl.to(q(".nf-wire-local"), { strokeDashoffset: 0, stagger: 0.22, duration: 1 }, 1.1);
        tl.to(q('.nf-container[data-c="a"]'), { opacity: 1, scale: 1, duration: 0.8 }, 1.7);

        // Act 3: link a second notebook in via the cross-notebook wire.
        tl.to(q('.nf-cap[data-cap="1"]'), { opacity: 0, y: -16, duration: 0.5 }, 2.1);
        tl.to(q('.nf-cap[data-cap="2"]'), { opacity: 1, y: 0, duration: 0.6 }, 2.3);
        tl.to(q(".nf-stage"), { scale: 0.95, duration: 1, ease: "power1.inOut" }, 2.1);
        tl.to(q('.nf-container[data-c="b"]'), { opacity: 1, scale: 1, duration: 0.7 }, 2.4);
        tl.to(
          q('.nf-node[data-node="forecast"]'),
          { opacity: 1, scale: 1, y: 0, duration: 0.7 },
          2.5,
        );
        tl.to(q(".nf-wire-cross"), { opacity: 1, duration: 0.6 }, 2.7);

        // Marching-ants flow on the cross wire (runs continuously once revealed).
        gsap.to(q(".nf-wire-cross"), {
          strokeDashoffset: "-=26",
          duration: 0.8,
          ease: "none",
          repeat: -1,
        });

        // Act 4: run pulse — light the DAG up in topological order.
        const runStart = 3.0;
        tl.to(q('.nf-cap[data-cap="2"]'), { opacity: 0, y: -16, duration: 0.5 }, runStart - 0.1);
        tl.to(q('.nf-cap[data-cap="3"]'), { opacity: 1, y: 0, duration: 0.6 }, runStart + 0.1);
        RUN_ORDER.forEach((id, i) => {
          const at = runStart + i * 0.4;
          const dot = q(`.nf-status[data-node="${id}"]`);
          tl.to(
            dot,
            {
              backgroundColor: RUN_TEAL,
              boxShadow: `0 0 0 4px ${TEAL_GLOW}`,
              scale: 1.5,
              duration: 0.2,
            },
            at,
          );
          tl.to(
            dot,
            { backgroundColor: RUN_OK, boxShadow: "0 0 0 0 transparent", scale: 1, duration: 0.3 },
            at + 0.22,
          );
        });
        tl.to(q(".nf-bar"), { scaleY: 1, stagger: 0.07, duration: 0.4 }, runStart + 0.6);
        tl.to(
          q(".nf-pill"),
          { opacity: 1, y: 0, duration: 0.4 },
          runStart + RUN_ORDER.length * 0.4,
        );
      }, root);

      onResize = () => ScrollTrigger.refresh();
      window.addEventListener("resize", onResize);
      ScrollTrigger.refresh();
    })();

    return () => {
      cancelled = true;
      if (onResize) window.removeEventListener("resize", onResize);
      ctx?.revert();
    };
  }, [reduced]);

  return (
    <section ref={rootRef} className="relative">
      <div ref={pinRef} className="relative h-[100svh] w-full overflow-hidden">
        {/* WebGL depth layer (client-only; skipped under reduced motion) */}
        {!reduced ? (
          <ClientOnly>
            <Suspense fallback={null}>
              <div className="pointer-events-none absolute inset-0 -z-0 opacity-90">
                <AmbientBackdrop paused={backdropPaused} dark={dark} />
              </div>
            </Suspense>
          </ClientOnly>
        ) : null}

        {/* Soft brand wash so the stage reads against the backdrop */}
        <div
          className="pointer-events-none absolute inset-0 -z-0"
          style={{
            background:
              "radial-gradient(70rem 40rem at 50% -10%, color-mix(in oklch, var(--primary) 16%, transparent), transparent 70%)",
          }}
        />

        {/* The graph stage */}
        <StageScaler reduced={reduced}>
          <GraphScene />
        </StageScaler>

        {/* Bottom scrim → captions */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
          style={{ background: "linear-gradient(to top, var(--background) 8%, transparent)" }}
        />
        <Captions />
        <ScrollCue />
      </div>
    </section>
  );
}

/** Scales the fixed 1200×820 stage to fit the pinned viewport. */
function StageScaler({
  children,
  reduced,
}: {
  children: ReactNode;
  reduced: boolean;
}): ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.62);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const pad = 0.9;
      const s = Math.min(width / DESIGN_W, height / DESIGN_H) * pad;
      setScale(Number.isFinite(s) && s > 0 ? s : 0.62);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 flex items-center justify-center"
      // Lift the stage up a touch so captions have room at the bottom.
      style={{ paddingBottom: reduced ? 0 : "8vh" }}
    >
      <div
        style={{
          width: DESIGN_W,
          height: DESIGN_H,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

interface Caption {
  kicker: string;
  body: ReactNode;
}

const CAPTIONS: Caption[] = [
  {
    kicker: "A notebook is a graph",
    body: (
      <>
        Mark cell groups with <code className="nf-code">{"# @node:"}</code> and NotebookFlow derives
        the DAG. Your
        <code className="nf-code">.ipynb</code> stays the source of truth.
      </>
    ),
  },
  {
    kicker: "Notebooks link to notebooks",
    body: (
      <>
        Wire outputs across files with cross-notebook refs —{" "}
        <code className="nf-code">data:Node.port</code>. Reuse whole pipelines like functions.
      </>
    ),
  },
  {
    kicker: "Run it",
    body: (
      <>
        Execute in dependency order. Stream results, charts, and AI output straight back into your
        cells.
      </>
    ),
  },
];

function Captions(): ReactElement {
  return (
    <div className="absolute inset-x-0 bottom-0 z-10">
      <div className="relative mx-auto max-w-6xl px-5 pb-12 sm:pb-16">
        {/* Caption 0 — the SSR hero: badge + H1 + CTAs */}
        <div className="nf-cap" data-cap="0">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <span className="size-1.5 rounded-full bg-primary" />
            Private beta
          </span>
          <h1 className="mt-4 max-w-2xl text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            n8n for your <span className="text-primary">notebooks</span>.
          </h1>
          <p className="mt-4 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Turn notebooks and cell groups into visual pipelines — with AI assistance,
            bring-your-own-key models, and bidirectional sync across the web, VS Code, and
            JupyterLab.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              to="/app"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
            >
              Launch app
              <ArrowRight className="size-4" />
            </Link>
            <Link
              to="/login"
              className="rounded-lg border border-border bg-card/80 px-5 py-2.5 text-sm font-semibold backdrop-blur transition-colors hover:bg-accent"
            >
              Sign in
            </Link>
          </div>
        </div>

        {/* Captions 1–3 — stacked in the same spot, crossfaded by the timeline */}
        {CAPTIONS.map((c, i) => (
          <div
            key={c.kicker}
            className="nf-cap absolute inset-x-5 bottom-12 sm:bottom-16"
            data-cap={i + 1}
            style={{ opacity: 0 }}
          >
            <h2 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">
              {c.kicker}
            </h2>
            <p className="mt-3 max-w-xl text-pretty text-base leading-relaxed text-foreground/90 sm:text-lg">
              {c.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

const cueStyle: CSSProperties = { writingMode: "vertical-rl" };

function ScrollCue(): ReactElement {
  return (
    <div className="nf-scrollcue pointer-events-none absolute bottom-6 right-6 z-10 flex flex-col items-center gap-2 text-muted-foreground">
      <span className="text-[10px] font-medium uppercase tracking-[0.2em]" style={cueStyle}>
        Scroll
      </span>
      <span className="h-10 w-px animate-pulse bg-gradient-to-b from-primary to-transparent" />
    </div>
  );
}
