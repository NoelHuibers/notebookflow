/**
 * /device — approval page for the OAuth device-authorization flow (#88).
 *
 * The VS Code / JupyterLab extensions POST /api/auth/device/code, show the
 * user code, and open this page (verification_uri_complete carries
 * ?user_code=...). The signed-in user confirms the code here; the GET
 * /api/auth/device call is the CLAIM step binding the code to this session —
 * it must happen before approve/deny (otherwise DEVICE_CODE_NOT_CLAIMED).
 */

import { ClientOnly, createFileRoute, Link } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { useEffect, useState } from "react";

import { GithubIcon, GoogleIcon } from "@/components/BrandIcons";
import { LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { authClient, useSession } from "@/lib/auth-client";
import { LanguageSwitcher, useI18n } from "@/lib/i18n";

interface DeviceSearch {
  user_code?: string;
}

export const Route = createFileRoute("/device")({
  validateSearch: (search: Record<string, unknown>): DeviceSearch => {
    // Destructured to satisfy both biome's literal-key rule and tsc's
    // noPropertyAccessFromIndexSignature (same trick as auth.ts / process.env).
    const { user_code: code } = search;
    return typeof code === "string" && code !== "" ? { user_code: code } : {};
  },
  component: DeviceRoute,
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

function DeviceRoute(): ReactElement {
  return (
    <ClientOnly fallback={<LoadingShell />}>
      <Device />
    </ClientOnly>
  );
}

function LoadingShell(): ReactElement {
  const { t } = useI18n();
  return (
    <Shell>
      <p className="py-4 text-sm text-muted-foreground">{t("device.loading")}</p>
    </Shell>
  );
}

function UserCode({ code }: { code: string }): ReactElement {
  return (
    <p className="mt-4 rounded-lg border border-border bg-muted/40 py-3 font-mono text-2xl font-semibold tracking-[0.3em]">
      {code}
    </p>
  );
}

function Device(): ReactElement {
  const session = useSession();
  const { t } = useI18n();
  const { user_code: userCode } = Route.useSearch();

  if (session.isPending) {
    return (
      <Shell>
        <p className="py-4 text-sm text-muted-foreground">{t("device.checkingSession")}</p>
      </Shell>
    );
  }

  if (!session.data) {
    // Signed out: sign in inline (like /login) and come straight back here
    // with the code preserved, so approval is one click after the redirect.
    const callbackURL =
      userCode === undefined ? "/device" : `/device?user_code=${encodeURIComponent(userCode)}`;
    return (
      <Shell>
        <h1 className="text-lg font-semibold tracking-tight">{t("device.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("device.signInPrompt")}</p>
        {userCode !== undefined && <UserCode code={userCode} />}
        <div className="mt-5 flex flex-col gap-2.5">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => void authClient.signIn.social({ provider: "github", callbackURL })}
          >
            <GithubIcon /> {t("login.continueGithub")}
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => void authClient.signIn.social({ provider: "google", callbackURL })}
          >
            <GoogleIcon /> {t("login.continueGoogle")}
          </Button>
        </div>
      </Shell>
    );
  }

  if (userCode === undefined) {
    return <EnterCode />;
  }
  return <Approval userCode={userCode} />;
}

/** Manual code entry, for when the page is opened without ?user_code. */
function EnterCode(): ReactElement {
  const { t } = useI18n();
  const navigate = Route.useNavigate();
  const [value, setValue] = useState("");
  const code = value.trim().toUpperCase();

  const submit = (): void => {
    if (code === "") return;
    void navigate({ search: { user_code: code } });
  };

  return (
    <Shell>
      <h1 className="text-lg font-semibold tracking-tight">{t("device.enterCodeTitle")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("device.enterCodePrompt")}</p>
      <form
        className="mt-5 flex flex-col gap-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t("device.codePlaceholder")}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-center font-mono text-lg uppercase tracking-[0.3em] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <Button type="submit" className="w-full" disabled={code === ""}>
          {t("device.continue")}
        </Button>
      </form>
    </Shell>
  );
}

type ApprovalStep =
  | { step: "claiming" }
  | { step: "confirm" }
  | { step: "done"; outcome: "approved" | "denied" }
  | { step: "failed"; messageKey: string };

function Approval({ userCode }: { userCode: string }): ReactElement {
  const { t } = useI18n();
  const [state, setState] = useState<ApprovalStep>({ step: "claiming" });
  const [busy, setBusy] = useState(false);

  // CLAIM the code for this session (GET /api/auth/device?user_code=...).
  // Server-side this binds the pending record to the signed-in user; approve
  // and deny 400 with DEVICE_CODE_NOT_CLAIMED without it.
  useEffect(() => {
    let cancelled = false;
    setState({ step: "claiming" });
    void authClient
      .device({ query: { user_code: userCode } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setState({ step: "failed", messageKey: "device.invalidCode" });
        } else if (data.status !== "pending") {
          setState({ step: "failed", messageKey: "device.alreadyHandled" });
        } else {
          setState({ step: "confirm" });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ step: "failed", messageKey: "device.requestFailed" });
      });
    return () => {
      cancelled = true;
    };
  }, [userCode]);

  const settle = (outcome: "approved" | "denied"): void => {
    setBusy(true);
    const action =
      outcome === "approved"
        ? authClient.device.approve({ userCode })
        : authClient.device.deny({ userCode });
    void action
      .then(({ error }) => {
        setState(
          error
            ? { step: "failed", messageKey: "device.requestFailed" }
            : { step: "done", outcome },
        );
      })
      .catch(() => setState({ step: "failed", messageKey: "device.requestFailed" }))
      .finally(() => setBusy(false));
  };

  if (state.step === "claiming") {
    return (
      <Shell>
        <p className="py-4 text-sm text-muted-foreground">{t("device.verifying")}</p>
      </Shell>
    );
  }

  if (state.step === "failed") {
    return (
      <Shell>
        <h1 className="text-lg font-semibold tracking-tight">{t("device.title")}</h1>
        <p className="mt-3 text-sm text-destructive">{t(state.messageKey)}</p>
        <div className="mt-5">
          <Button asChild variant="outline" className="w-full">
            <Link to="/device">{t("device.useDifferentCode")}</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  if (state.step === "done") {
    return (
      <Shell>
        <h1 className="text-lg font-semibold tracking-tight">
          {state.outcome === "approved" ? t("device.approvedTitle") : t("device.deniedTitle")}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {state.outcome === "approved" ? t("device.approvedBody") : t("device.deniedBody")}
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-lg font-semibold tracking-tight">{t("device.confirmTitle")}</h1>
      <UserCode code={userCode} />
      <p className="mt-3 text-sm text-muted-foreground">{t("device.confirmBody")}</p>
      <div className="mt-5 flex flex-col gap-2">
        <Button className="w-full" disabled={busy} onClick={() => settle("approved")}>
          {busy ? t("device.working") : t("device.approve")}
        </Button>
        <Button
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => settle("denied")}
        >
          {t("device.deny")}
        </Button>
      </div>
    </Shell>
  );
}
