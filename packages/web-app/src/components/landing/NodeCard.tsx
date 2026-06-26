/**
 * Presentational graph node — a faithful, lightweight echo of the real
 * NotebookNode (packages/graph-canvas/src/components/Node.tsx), with no React
 * Flow / interactivity. Fills its absolutely-positioned parent.
 *
 * Animatable hooks for the scroll timeline:
 *   .nf-status[data-node]  — the runtime dot (idle → teal → green during run)
 *   .nf-bar                — output chart bars (scaleY 0 → 1 during run)
 */
import type { CSSProperties, ReactElement } from "react";

import { IDLE_DOT, type GraphNode, TAG_COLOR } from "./graph-data";

const cardStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  borderRadius: 12,
  overflow: "hidden",
  background: "var(--card)",
  border: "1px solid var(--border)",
  boxShadow: "0 10px 30px -18px rgb(0 0 0 / 0.45)",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
};

export function NodeCard({ node }: { node: GraphNode }): ReactElement {
  const color = TAG_COLOR[node.tag];
  return (
    <div style={cardStyle}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px",
          background: color,
          color: "#fff",
        }}
      >
        <span
          className="nf-status"
          data-node={node.id}
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: IDLE_DOT,
            boxShadow: "0 0 0 0 transparent",
            flex: "none",
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em", flex: 1, whiteSpace: "nowrap" }}>
          {node.name}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            padding: "2px 6px",
            borderRadius: 999,
            background: "rgb(255 255 255 / 0.2)",
          }}
        >
          {node.tag}
        </span>
      </div>

      {/* Body */}
      <div style={{ position: "relative", flex: 1, padding: "9px 12px" }}>
        {node.chart ? (
          <Chart color={color} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Bar w="78%" />
            <Bar w="52%" muted />
          </div>
        )}

        {node.meta ? (
          <div
            style={{
              position: "absolute",
              left: 12,
              bottom: 8,
              fontSize: 10,
              color: "var(--muted-foreground)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {node.meta}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Bar({ w, muted }: { w: string; muted?: boolean }): ReactElement {
  return (
    <span
      style={{
        height: 5,
        width: w,
        borderRadius: 3,
        background: muted ? "var(--muted)" : "color-mix(in oklch, var(--muted-foreground) 45%, transparent)",
      }}
    />
  );
}

/** Mini bar chart for the [output] node — bars grow on run via .nf-bar. */
function Chart({ color }: { color: string }): ReactElement {
  const bars = [0.4, 0.7, 1, 0.55];
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 38 }}>
      {bars.map((h, i) => (
        <span
          key={i}
          className="nf-bar"
          style={{
            width: 12,
            height: `${h * 100}%`,
            borderRadius: 2,
            background: color,
            opacity: 0.4 + h * 0.55,
            transformOrigin: "bottom",
          }}
        />
      ))}
    </div>
  );
}
