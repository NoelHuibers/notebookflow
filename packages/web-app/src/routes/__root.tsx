import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";

import { LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";

import "reactflow/dist/style.css";
import "../index.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "NotebookFlow — visual pipelines for notebooks" },
      {
        name: "description",
        content:
          "Wire notebooks and cell groups into visual pipelines on a canvas, with AI assistance, bring-your-own-key models, and bidirectional sync.",
      },
      { property: "og:title", content: "NotebookFlow" },
      {
        property: "og:description",
        content: "n8n for your notebooks — visual pipelines with AI, BYOK, and bidirectional sync.",
      },
      { property: "og:type", content: "website" },
      { name: "theme-color", content: "#0d9488" },
    ],
    links: [{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }],
  }),
  notFoundComponent: NotFound,
  component: RootComponent,
});

function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-4 text-center font-sans text-foreground antialiased">
      <LogoMark className="size-9 text-primary" />
      <div>
        <p className="font-mono text-sm font-medium text-primary">404</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">That page doesn't exist or has moved.</p>
      </div>
      <div className="flex gap-3">
        <Button asChild>
          <Link to="/app">Launch app</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/">Home</Link>
        </Button>
      </div>
    </main>
  );
}

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body style={{ margin: 0 }}>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
