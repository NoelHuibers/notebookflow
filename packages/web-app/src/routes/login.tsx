import { ClientOnly, createFileRoute, Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { GithubIcon, GoogleIcon } from "@/components/BrandIcons";
import { LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { authClient, useSession } from "@/lib/auth-client";
import { LanguageSwitcher, useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/login")({
  component: LoginRoute,
});

function Shell({ children }: { children: ReactNode }): ReactElement {
  const { t } = useI18n();
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-10 font-sans text-foreground antialiased">
      <LanguageSwitcher className="absolute right-4 top-4" />
      <Link to="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
        <LogoMark className="size-7 text-primary" />
        <span className="text-xl font-bold tracking-tight">NotebookFlow</span>
      </Link>
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        {children}
      </div>
      <Link
        to="/"
        className="text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {t("common.backHome")}
      </Link>
    </main>
  );
}

function LoginRoute(): ReactElement {
  return (
    <ClientOnly fallback={<LoadingShell />}>
      <Login />
    </ClientOnly>
  );
}

function LoadingShell(): ReactElement {
  const { t } = useI18n();
  return (
    <Shell>
      <p className="py-4 text-sm text-muted-foreground">{t("login.loading")}</p>
    </Shell>
  );
}

function Login(): ReactElement {
  const session = useSession();
  const { t } = useI18n();

  if (session.isPending) {
    return (
      <Shell>
        <p className="py-4 text-sm text-muted-foreground">{t("login.checkingSession")}</p>
      </Shell>
    );
  }

  if (session.data) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">
          {t("login.signedInAs")}{" "}
          <span className="font-medium text-foreground">{session.data.user.email}</span>
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link to="/app">{t("common.launchApp")}</Link>
          </Button>
          <Button variant="outline" className="w-full" onClick={() => void authClient.signOut()}>
            <LogOut /> {t("common.signOut")}
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-lg font-semibold tracking-tight">{t("login.welcome")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("login.subtitle")}</p>
      <div className="mt-5 flex flex-col gap-2.5">
        <Button
          variant="outline"
          className="w-full"
          onClick={() => void authClient.signIn.social({ provider: "github", callbackURL: "/app" })}
        >
          <GithubIcon /> {t("login.continueGithub")}
        </Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => void authClient.signIn.social({ provider: "google", callbackURL: "/app" })}
        >
          <GoogleIcon /> {t("login.continueGoogle")}
        </Button>
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        {t("login.betaNote")}
      </p>
    </Shell>
  );
}
