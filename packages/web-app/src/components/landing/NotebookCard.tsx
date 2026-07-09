/**
 * The source notebook card shown in the hero — a stylised .ipynb with the real
 * `# @node:` markers from examples/preprocessing.ipynb. Lightweight static Python
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
    marker: "# @node: Load customer data  [input]  out=raw_df",
    lines: [
      { code: "import numpy as np", kind: "kw" },
      { code: 'raw_df = pd.DataFrame({"channel": …, "revenue": …})' },
    ],
  },
  {
    marker:
      "# @node: Clean features  [transform]  in=raw_df<-Load customer data.raw_df  out=feature_df",
    lines: [{ code: 'feature_df["ad_spend"] = feature_df["ad_spend"].fillna(…)' }],
  },
  {
    marker:
      "# @node: Train test split  [transform]  in=feature_df<-Clean features.feature_df  out=train_df,test_df,feature_cols",
    lines: [{ code: "train_df = feature_df.iloc[:cutoff].copy()" }],
  },
  {
    marker: "# model_baseline.ipynb consumes preprocessing:Train test split.train_df",
    lines: [{ code: "cross-notebook refs stay visible on the canvas", kind: "fn" }],
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
          preprocessing.ipynb
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
