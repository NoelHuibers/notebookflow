import { ClientOnly, createFileRoute, Link } from "@tanstack/react-router";

import { authClient, useSession } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({
  component: LoginRoute,
});

const shell: React.CSSProperties = {
  display: "flex",
  minHeight: "100vh",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "1rem",
  fontFamily: "system-ui, sans-serif",
  textAlign: "center",
  padding: "2rem",
};

const button: React.CSSProperties = {
  minWidth: "16rem",
  borderRadius: "0.5rem",
  border: "1px solid #d4d4d8",
  background: "white",
  padding: "0.6rem 1.25rem",
  fontWeight: 600,
  cursor: "pointer",
};

const primaryLink: React.CSSProperties = {
  borderRadius: "0.5rem",
  background: "#0d9488",
  color: "white",
  padding: "0.6rem 1.25rem",
  fontWeight: 600,
  textDecoration: "none",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={shell}>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700 }}>NotebookFlow</h1>
      {children}
    </main>
  );
}

function LoginRoute() {
  return (
    <ClientOnly
      fallback={
        <Shell>
          <p style={{ color: "#52525b" }}>Loading…</p>
        </Shell>
      }
    >
      <Login />
    </ClientOnly>
  );
}

function Login() {
  const session = useSession();

  if (session.isPending) {
    return (
      <Shell>
        <p style={{ color: "#52525b" }}>Checking your session…</p>
      </Shell>
    );
  }

  if (session.data) {
    return (
      <Shell>
        <p style={{ color: "#52525b" }}>
          Signed in as <strong>{session.data.user.email}</strong>
        </p>
        <Link to="/app" style={primaryLink}>
          Launch app
        </Link>
        <button type="button" style={button} onClick={() => void authClient.signOut()}>
          Sign out
        </button>
      </Shell>
    );
  }

  return (
    <Shell>
      <p style={{ color: "#52525b", maxWidth: "28rem" }}>Sign in to save your work to the cloud.</p>
      <button
        type="button"
        style={button}
        onClick={() => void authClient.signIn.social({ provider: "github", callbackURL: "/app" })}
      >
        Continue with GitHub
      </button>
      <button
        type="button"
        style={button}
        onClick={() => void authClient.signIn.social({ provider: "google", callbackURL: "/app" })}
      >
        Continue with Google
      </button>
      <Link to="/" style={{ color: "#0d9488", textDecoration: "none", marginTop: "0.5rem" }}>
        ← Back
      </Link>
    </Shell>
  );
}
