import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

// Public landing placeholder. The full bilingual marketing page is #75.
function Home() {
  return (
    <main
      style={{
        display: "flex",
        minHeight: "100vh",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <h1 style={{ fontSize: "2rem", fontWeight: 700 }}>NotebookFlow</h1>
      <p style={{ color: "#52525b", maxWidth: "32rem" }}>
        n8n-style workflow orchestration for computational notebooks — visually wire notebooks and
        cell groups into pipelines, with AI assistance and bidirectional sync.
      </p>
      <Link
        to="/app"
        style={{
          marginTop: "0.5rem",
          borderRadius: "0.5rem",
          background: "#0d9488",
          color: "white",
          padding: "0.6rem 1.25rem",
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Launch app
      </Link>
    </main>
  );
}
