import { ClientOnly, createFileRoute, Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { authClient, useSession } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({
  component: LoginRoute,
});

// lucide-react dropped brand marks, so GitHub/Google are inlined.
function GithubIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.2 3.44 9.6 8.21 11.16.6.11.82-.25.82-.56v-2.18c-3.34.71-4.04-1.6-4.04-1.6-.55-1.36-1.33-1.72-1.33-1.72-1.09-.73.08-.71.08-.71 1.2.08 1.84 1.22 1.84 1.22 1.07 1.8 2.81 1.28 3.5.98.11-.76.42-1.28.76-1.57-2.67-.3-5.47-1.31-5.47-5.83 0-1.29.47-2.34 1.23-3.17-.12-.3-.53-1.52.12-3.16 0 0 1-.32 3.3 1.21a11.5 11.5 0 0 1 6 0c2.28-1.53 3.29-1.21 3.29-1.21.65 1.64.24 2.86.12 3.16.77.83 1.23 1.88 1.23 3.17 0 4.53-2.81 5.52-5.49 5.81.43.37.81 1.1.81 2.22v3.29c0 .31.21.68.82.56A12.01 12.01 0 0 0 24 12.29C24 5.78 18.63.5 12 .5z" />
    </svg>
  );
}

function GoogleIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.04 12.26c0-.82-.07-1.6-.21-2.36H12v4.46h6.19a5.3 5.3 0 0 1-2.3 3.48v2.9h3.72c2.17-2 3.43-4.94 3.43-8.48z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.1 0 5.7-1.03 7.6-2.8l-3.72-2.9c-1.03.7-2.35 1.1-3.88 1.1-2.98 0-5.5-2-6.4-4.72H1.76v2.99A11.99 11.99 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.6 14.68a7.2 7.2 0 0 1 0-4.6V7.09H1.76a12 12 0 0 0 0 10.58l3.84-2.99z"
      />
      <path
        fill="#EA4335"
        d="M12 4.76c1.68 0 3.2.58 4.39 1.72l3.3-3.3C17.7 1.2 15.1 0 12 0 7.34 0 3.3 2.67 1.76 6.59l3.84 2.99C6.5 6.86 9.02 4.76 12 4.76z"
      />
    </svg>
  );
}

function Shell({ children }: { children: ReactNode }): ReactElement {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-10 font-sans text-foreground antialiased">
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
        ← Back to home
      </Link>
    </main>
  );
}

function LoginRoute(): ReactElement {
  return (
    <ClientOnly
      fallback={
        <Shell>
          <p className="py-4 text-sm text-muted-foreground">Loading…</p>
        </Shell>
      }
    >
      <Login />
    </ClientOnly>
  );
}

function Login(): ReactElement {
  const session = useSession();

  if (session.isPending) {
    return (
      <Shell>
        <p className="py-4 text-sm text-muted-foreground">Checking your session…</p>
      </Shell>
    );
  }

  if (session.data) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">
          Signed in as{" "}
          <span className="font-medium text-foreground">{session.data.user.email}</span>
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link to="/app">Launch app</Link>
          </Button>
          <Button variant="outline" className="w-full" onClick={() => void authClient.signOut()}>
            <LogOut /> Sign out
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-lg font-semibold tracking-tight">Welcome to NotebookFlow</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Sign in to save your work and run pipelines.
      </p>
      <div className="mt-5 flex flex-col gap-2.5">
        <Button
          variant="outline"
          className="w-full"
          onClick={() => void authClient.signIn.social({ provider: "github", callbackURL: "/app" })}
        >
          <GithubIcon /> Continue with GitHub
        </Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => void authClient.signIn.social({ provider: "google", callbackURL: "/app" })}
        >
          <GoogleIcon /> Continue with Google
        </Button>
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Private beta — access is limited while we're testing.
      </p>
    </Shell>
  );
}
