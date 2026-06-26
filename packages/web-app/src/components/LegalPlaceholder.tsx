import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { Wordmark } from "@/components/Logo";

// Shared shell for the legal pages. Real bilingual content (DE + EN) lands in #76;
// operator entity details are still needed for the Impressum.
export function LegalPlaceholder({ title }: { title: string }): ReactElement {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground antialiased">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3.5">
          <Link to="/" className="transition-opacity hover:opacity-80">
            <Wordmark />
          </Link>
          <Link
            to="/"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Back
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-4 leading-relaxed text-muted-foreground">
          This page is a placeholder — the full bilingual (DE&nbsp;+&nbsp;EN) content is coming
          soon.
        </p>
      </main>
    </div>
  );
}
