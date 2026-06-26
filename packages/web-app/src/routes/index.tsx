import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Boxes, KeyRound, Sparkles, Workflow } from "lucide-react";
import type { ReactElement } from "react";

import { LandingHero } from "@/components/landing/LandingHero";
import { Wordmark } from "@/components/Logo";

export const Route = createFileRoute("/")({
  component: Home,
});

const FEATURES = [
  {
    icon: Workflow,
    title: "Visual pipeline canvas",
    body: "Drag cells and notebooks onto a canvas and wire them into a DAG. The same graph, edited from either side — code and canvas stay in sync.",
  },
  {
    icon: Sparkles,
    title: "AI woven in",
    body: "Generate nodes from a prompt, explain a pipeline in plain English, or ask anything with ⌘K — right where you work.",
  },
  {
    icon: KeyRound,
    title: "Bring your own key",
    body: "Use your own OpenAI, Anthropic, or other provider key. Stored encrypted at rest, decrypted only to make the call — never harvested.",
  },
  {
    icon: Boxes,
    title: "Runs anywhere",
    body: "One engine behind the web app, VS Code, and JupyterLab — or point at your own. Your notebooks, your compute.",
  },
];

const STEPS = [
  { n: "1", title: "Bring your data", body: "Drop a notebook or a CSV, or start from a template." },
  { n: "2", title: "Wire it up", body: "Compose cells and notebooks into a pipeline on the canvas." },
  { n: "3", title: "Run it", body: "Stream results, charts, and AI output back into your cells." },
];

function Home(): ReactElement {
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
              Sign in
            </Link>
            <Link
              to="/app"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
            >
              Launch app
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
              A notebook that thinks in pipelines
            </h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-sm"
                >
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <f.icon className="size-4.5" />
                  </div>
                  <h3 className="mt-3.5 font-semibold tracking-tight">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
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
                <div key={s.n}>
                  <div className="flex size-8 items-center justify-center rounded-full border border-primary/40 font-mono text-sm font-semibold text-primary">
                    {s.n}
                  </div>
                  <h3 className="mt-3 font-semibold tracking-tight">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-border/60 bg-card/30">
          <div className="mx-auto max-w-6xl px-5 py-16 text-center md:py-20">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Ready to wire up your first pipeline?
            </h2>
            <Link
              to="/app"
              className="mt-7 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
            >
              Launch app
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
              Impressum
            </Link>
            <Link to="/legal/datenschutz" className="transition-colors hover:text-foreground">
              Datenschutz
            </Link>
            <Link to="/legal/agb" className="transition-colors hover:text-foreground">
              AGB
            </Link>
          </nav>
          <span>© 2026 NotebookFlow</span>
        </div>
      </footer>
    </div>
  );
}
