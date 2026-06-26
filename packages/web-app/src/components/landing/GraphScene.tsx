/**
 * GraphScene — the fixed-design-space stage (DESIGN_W × DESIGN_H) that the
 * scroll timeline animates. It renders the *final composed state* of the graph
 * (every element visible, at rest), which doubles as:
 *   - the SSR / no-JS / reduced-motion fallback, and
 *   - the canvas the GSAP timeline rewinds to the "hero" state, then plays.
 *
 * Animatable classes / data-attrs consumed by LandingHero's timeline:
 *   .nf-source                         the hero notebook card
 *   .nf-container[data-c]              notebook container outlines
 *   .nf-node[data-node]                each graph node (wrapper)
 *   .nf-wire[data-edge] / -local/-cross  SVG edge paths
 *   .nf-port[data-node-side]          port dots
 *   .nf-pill                           run-status pill
 *   .nf-status / .nf-bar               (inside NodeCard)
 */
import type { CSSProperties, ReactElement } from "react";

import {
  CONTAINERS,
  DESIGN_H,
  DESIGN_W,
  EDGES,
  type GraphNode,
  NODE_H,
  NODE_W,
  NODES,
  PORT_CY,
  TAG_COLOR,
  WIRE_CROSS,
  edgePath,
} from "./graph-data";
import { NodeCard } from "./NodeCard";
import { NotebookCard } from "./NotebookCard";

const stage: CSSProperties = {
  position: "relative",
  width: DESIGN_W,
  height: DESIGN_H,
};

export function GraphScene(): ReactElement {
  return (
    <div className="nf-stage" style={stage}>
      {/* Notebook containers (behind everything) */}
      {CONTAINERS.map((c) => (
        <div
          key={c.id}
          className="nf-container"
          data-c={c.id}
          style={{
            position: "absolute",
            left: c.x,
            top: c.y,
            width: c.w,
            height: c.h,
            borderRadius: 16,
            border: "1.5px dashed color-mix(in oklch, var(--primary) 45%, transparent)",
            background: "color-mix(in oklch, var(--primary) 6%, transparent)",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 8,
              left: 14,
              fontSize: 11,
              fontWeight: 600,
              color: "color-mix(in oklch, var(--primary) 85%, var(--foreground))",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            {c.label}
          </span>
        </div>
      ))}

      {/* Wires + ports (SVG overlay matching the design viewBox) */}
      <svg
        viewBox={`0 0 ${DESIGN_W} ${DESIGN_H}`}
        width={DESIGN_W}
        height={DESIGN_H}
        style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
        aria-hidden="true"
      >
        {EDGES.map((e) => {
          const cross = e.kind === "cross";
          return (
            <path
              key={e.id}
              className={`nf-wire ${cross ? "nf-wire-cross" : "nf-wire-local"}`}
              data-edge={e.id}
              d={edgePath(e)}
              fill="none"
              stroke={cross ? WIRE_CROSS : "var(--nf-wire-local)"}
              strokeWidth={cross ? 2.5 : 2}
              strokeLinecap="round"
              strokeDasharray={cross ? "7 6" : undefined}
            />
          );
        })}
        {NODES.map((n) => <Ports key={n.id} node={n} />)}
      </svg>

      {/* Nodes */}
      {NODES.map((n) => (
        <div
          key={n.id}
          className="nf-node"
          data-node={n.id}
          style={{ position: "absolute", left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
        >
          <NodeCard node={n} />
        </div>
      ))}

      {/* Run-status pill */}
      <div
        className="nf-pill"
        style={{
          position: "absolute",
          left: "50%",
          top: 640,
          transform: "translateX(-50%)",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 14px",
          borderRadius: 999,
          background: "var(--card)",
          border: "1px solid var(--border)",
          boxShadow: "0 10px 30px -16px rgb(0 0 0 / 0.5)",
          fontSize: 13,
          fontWeight: 600,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          color: "var(--foreground)",
        }}
      >
        <span style={{ color: "#10b981" }}>✓</span> 5 nodes ok
        <span style={{ color: "var(--muted-foreground)", fontWeight: 500 }}>· 1.2s</span>
      </div>

      {/* Hero source notebook. Hidden in the resting markup so the SSR / no-JS /
          reduced-motion fallback shows the clean final-state graph; the GSAP
          timeline reveals it (and hides the graph) for the hero, pre-paint. */}
      <div
        className="nf-source"
        style={{ position: "absolute", left: (DESIGN_W - 480) / 2, top: 120, width: 480, height: 540, opacity: 0 }}
      >
        <NotebookCard />
      </div>
    </div>
  );
}

function Ports({ node }: { node: GraphNode }): ReactElement {
  const color = TAG_COLOR[node.tag];
  const cy = node.y + PORT_CY;
  return (
    <>
      {node.in?.length ? <PortDot id={node.id} side="in" x={node.x} y={cy} color={color} /> : null}
      {node.out?.length ? <PortDot id={node.id} side="out" x={node.x + NODE_W} y={cy} color={color} /> : null}
    </>
  );
}

function PortDot({
  id,
  side,
  x,
  y,
  color,
}: {
  id: string;
  side: "in" | "out";
  x: number;
  y: number;
  color: string;
}): ReactElement {
  return (
    <circle className="nf-port" data-node-side={`${id}-${side}`} cx={x} cy={y} r={5} fill="var(--card)" stroke={color} strokeWidth={2} />
  );
}
