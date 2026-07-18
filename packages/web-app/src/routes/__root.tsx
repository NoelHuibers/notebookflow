import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";

import { LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  I18nProvider,
  LanguageSwitcher,
  LOCALE_COOKIE,
  type Locale,
  resolveLocale,
  useI18n,
} from "@/lib/i18n";

import "reactflow/dist/style.css";
import "../index.css";

const SITE_ORIGIN = "https://notebookflow.vercel.app";
const PAGE_TITLE = "NotebookFlow | Visual pipelines for notebooks";
const PAGE_DESCRIPTION =
  "Wire notebooks and cell groups into visual pipelines on a canvas, with AI assistance, bring-your-own-key models, and bidirectional sync.";
const SOCIAL_DESCRIPTION =
  "Connect notebook cells into visual pipelines with AI, BYOK, and bidirectional sync.";
const SOCIAL_IMAGE_URL = `${SITE_ORIGIN}/og-image.png`;

// Resolve the locale on the server from the request (cookie → Accept-Language), and on
// the client from document.cookie → navigator.language. Same precedence both sides, so
// SSR and hydration agree. The server-only import is behind `import.meta.env.SSR`, so it
// is dead-code-eliminated from the client bundle.
async function loadLocale(): Promise<Locale> {
  if (import.meta.env.SSR) {
    const { getCookie, getRequestHeader } = await import("@tanstack/react-start/server");
    return resolveLocale(getCookie(LOCALE_COOKIE), getRequestHeader("accept-language"));
  }
  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${LOCALE_COOKIE}=`))
    ?.split("=")[1];
  return resolveLocale(cookie, navigator.language);
}

export const Route = createRootRoute({
  beforeLoad: async () => ({ locale: await loadLocale() }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: PAGE_TITLE },
      { name: "application-name", content: "NotebookFlow" },
      { name: "description", content: PAGE_DESCRIPTION },
      { property: "og:title", content: PAGE_TITLE },
      { property: "og:description", content: SOCIAL_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "NotebookFlow" },
      { property: "og:url", content: SITE_ORIGIN },
      { property: "og:image", content: SOCIAL_IMAGE_URL },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "NotebookFlow — visual pipelines for notebooks" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: PAGE_TITLE },
      { name: "twitter:description", content: SOCIAL_DESCRIPTION },
      { name: "twitter:image", content: SOCIAL_IMAGE_URL },
      { name: "twitter:image:alt", content: "NotebookFlow — visual pipelines for notebooks" },
      { name: "theme-color", content: "#0d9488" },
    ],
    links: [
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  notFoundComponent: NotFound,
  component: RootComponent,
});

function NotFound() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-4 text-center font-sans text-foreground antialiased">
      <LogoMark className="size-9 text-primary" />
      <div>
        <p className="font-mono text-sm font-medium text-primary">{t("notFound.code")}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t("notFound.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("notFound.body")}</p>
      </div>
      <div className="flex gap-3">
        <Button asChild>
          <Link to="/app">{t("common.launchApp")}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/">{t("common.home")}</Link>
        </Button>
      </div>
      <LanguageSwitcher className="mt-1" />
    </main>
  );
}

function RootComponent() {
  const { locale } = Route.useRouteContext();
  return (
    <html lang={locale}>
      <head>
        <HeadContent />
      </head>
      <body style={{ margin: 0 }}>
        <I18nProvider locale={locale}>
          <Outlet />
        </I18nProvider>
        <Scripts />
      </body>
    </html>
  );
}
