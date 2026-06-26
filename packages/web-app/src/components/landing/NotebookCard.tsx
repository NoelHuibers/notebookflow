/**
 * The source notebook card shown in the hero — a stylised .ipynb with the real
 * `# @node:` markers from examples/demo.ipynb. Lightweight static Python
 * tinting (no CodeMirror). The marker lines carry `.nf-marker` so the scroll
 * timeline can make them glow ("this comment is what derives the node").
 *
 * Fills its absolutely-positioned parent.
 */
import type { CSSProperties, ReactElement } from "react";

import { LogoMark } from "@/components/Logo";

const shell: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  borderRadius: 16,
  overflow: "hidden",
  background: "var(--card)",
  border: "1px solid var(--border)",
  boxShadow: "0 30px 80px -40px rgb(0 0 0 / 0.55)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

interface Cell {
  marker: string;
  lines: { code: string; kind?: "kw" | "str" | "fn" }[];
}

const CELLS: Cell[] = [
  {
    marker: "# @node: Load Data  [input]  out=df",
    lines: [
      { code: "import pandas as pd", kind: "kw" },
      { code: 'df = pd.DataFrame({"region": …, "revenue": …})' },
    ],
  },
  {
    marker: "# @node: Filter  [transform]  in=Load Data.df  out=clean_df",
    lines: [{ code: 'clean_df = df.dropna(subset=["revenue"])' }],
  },
  {
    marker: "# @node: Summarize  [transform]  in=Filter.clean_df  out=by_region",
    lines: [{ code: 'by_region = clean_df.groupby("region").agg(…)' }],
  },
  {
    marker: "# @node: Report  [output]  in=Summarize.by_region",
    lines: [{ code: "print(by_region.to_string(index=False))", kind: "fn" }],
  },
];

export function NotebookCard(): ReactElement {
  return (
    <div style={shell}>
      {/* Titlebar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          background: "color-mix(in oklch, var(--muted) 60%, var(--card))",
        }}
      >
        <LogoMark className="size-4 text-primary" />
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>
          pipeline.ipynb
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
          {["#ef4444", "#f59e0b", "#10b981"].map((c) => (
            <span
              key={c}
              style={{ width: 9, height: 9, borderRadius: 999, background: c, opacity: 0.7 }}
            />
          ))}
        </span>
      </div>

      {/* Cells */}
      <div
        style={{
          flex: 1,
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          fontSize: 12,
          lineHeight: 1.55,
        }}
      >
        {CELLS.map((cell, i) => (
          <div key={cell.marker} style={{ display: "flex", gap: 10 }}>
            <span
              style={{
                color: "var(--muted-foreground)",
                opacity: 0.45,
                userSelect: "none",
                flex: "none",
              }}
            >
              [{i + 1}]
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                className="nf-marker"
                style={{
                  color: "#14b8a6",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {cell.marker}
              </div>
              {cell.lines.map((ln) => (
                <div
                  key={ln.code}
                  style={{
                    color: tint(ln.kind),
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {ln.code}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function tint(kind?: "kw" | "str" | "fn"): string {
  switch (kind) {
    case "kw":
      return "#a855f7";
    case "str":
      return "#10b981";
    case "fn":
      return "#3b82f6";
    default:
      return "var(--foreground)";
  }
}
