import type { ReactElement } from "react";

// Shared shell for the legal placeholder pages. Real bilingual content (DE + EN)
// lands in #76; operator entity details are still needed for the Impressum.
export function LegalPlaceholder({ title }: { title: string }): ReactElement {
  return (
    <main
      style={{
        margin: "0 auto",
        maxWidth: "48rem",
        padding: "3rem 1.5rem",
        fontFamily: "system-ui, sans-serif",
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700 }}>{title}</h1>
      <p style={{ color: "#52525b" }}>
        Placeholder. The full bilingual (DE + EN) content lands in #76.
      </p>
      <p style={{ marginTop: "1.5rem" }}>
        <a href="/" style={{ color: "#0d9488" }}>
          ← Back home
        </a>
      </p>
    </main>
  );
}
