import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Boxes, KeyRound, Sparkles, Workflow } from "lucide-react";
import type { ReactElement } from "react";
import { Wordmark } from "@/components/Logo";
import { LandingHero } from "@/components/landing/LandingHero";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  component: Home,
});

const FEATURES = [
  { icon: Workflow, key: "f1" },
  { icon: Sparkles, key: "f2" },
  { icon: KeyRound, key: "f3" },
  { icon: Boxes, key: "f4" },
] as const;

const STEPS = [
  { n: "1", key: "step1" },
  { n: "2", key: "step2" },
  { n: "3", key: "step3" },
] as const;

function Home(): ReactElement {
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Wordmark />
          <nav className="flex items-center gap-2">
            <Link
              to="/login"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("common.signIn")}
            </Link>
            <Link
              to="/app"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
            >
              {t("common.launchApp")}
              <ArrowRight className="size-3.5" />
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero — cinematic, scroll-scrubbed graph story */}
        <LandingHero />

        {/* Features */}
        <section className="border-t border-border/60 bg-card/30">
          <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              {t("landing.featuresHeading")}
            </h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <div
                  key={f.key}
                  className="rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-sm"
                >
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <f.icon className="size-4.5" />
                  </div>
                  <h3 className="mt-3.5 font-semibold tracking-tight">
                    {t(`landing.${f.key}Title`)}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {t(`landing.${f.key}Body`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
            <div className="grid gap-8 sm:grid-cols-3">
              {STEPS.map((s) => (
                <div key={s.key}>
                  <div className="flex size-8 items-center justify-center rounded-full border border-primary/40 font-mono text-sm font-semibold text-primary">
                    {s.n}
                  </div>
                  <h3 className="mt-3 font-semibold tracking-tight">
                    {t(`landing.${s.key}Title`)}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t(`landing.${s.key}Body`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-border/60 bg-card/30">
          <div className="mx-auto max-w-6xl px-5 py-16 text-center md:py-20">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {t("landing.ctaHeading")}
            </h2>
            <Link
              to="/app"
              className="mt-7 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
            >
              {t("common.launchApp")}
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row">
          <Wordmark className="text-foreground" />
          <nav className="flex items-center gap-5">
            <Link to="/legal/impressum" className="transition-colors hover:text-foreground">
              {t("landing.footerImpressum")}
            </Link>
            <Link to="/legal/datenschutz" className="transition-colors hover:text-foreground">
              {t("landing.footerPrivacy")}
            </Link>
            <Link to="/legal/agb" className="transition-colors hover:text-foreground">
              {t("landing.footerTerms")}
            </Link>
          </nav>
          <span>© 2026 NotebookFlow</span>
        </div>
      </footer>
    </div>
  );
}
