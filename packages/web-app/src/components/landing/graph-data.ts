/**
 * Layout + palette for the landing-page graph scene.
 *
 * Everything lives in a fixed design coordinate space (DESIGN_W × DESIGN_H);
 * GraphScene positions nodes with absolute px in that space and StageScaler
 * scales the whole stage to fit the viewport. Wires are drawn in an SVG with a
 * matching viewBox, so node ports and bezier paths line up exactly.
 *
 * Colours are transcribed from the real product surface
 * (packages/graph-canvas/src/components/Node.tsx) so the preview reads as a
 * faithful slice of the app, not an invented mock.
 */

export const DESIGN_W = 1200;
export const DESIGN_H = 820;

export const NODE_W = 208;
export const NODE_H = 92;
/** Vertical centre of a node's left/right ports, relative to the node top. */
export const PORT_CY = 46;

export type NodeTag = "input" | "transform" | "output" | "ai" | "io";

/** Tag → header colour (from Node.tsx TAG_HEADER_BG / TAG_HANDLE_COLOR). */
export const TAG_COLOR: Record<NodeTag, string> = {
  input: "#3b82f6",
  transform: "#10b981",
  output: "#ef4444",
  ai: "#a855f7",
  io: "#f97316",
};

/** Runtime accents (from Node.tsx RUNTIME_BADGES). */
export const RUN_TEAL = "#2dd4bf"; // running / queued
export const RUN_OK = "#10b981"; // ok
export const IDLE_DOT = "#9ca3af";

/** Cross-notebook wire — purple dashed (from Wire.tsx). */
export const WIRE_CROSS = "#7c3aed";

export interface GraphNode {
  id: string;
  name: string;
  tag: NodeTag;
  /** Top-left in design space. */
  x: number;
  y: number;
  /** Declared input refs (nodeName.port or alias:nodeName.port). */
  in?: string[];
  /** Declared output port names. */
  out?: string[];
  /** Meta line: filename and/or row count, like the real node. */
  meta?: string;
  /** The [output] node renders a mini bar chart. */
  chart?: boolean;
}

/** The bundled analyst pipeline: preprocessing feeds two model notebooks, then postprocessing. */
export const NODES: GraphNode[] = [
  {
    id: "load",
    name: "Load customer data",
    tag: "input",
    x: 64,
    y: 124,
    out: ["raw_df"],
    meta: "520 rows",
  },
  {
    id: "clean",
    name: "Clean features",
    tag: "transform",
    x: 316,
    y: 124,
    in: ["Load customer data.raw_df"],
    out: ["feature_df"],
    meta: "feature set",
  },
  {
    id: "split",
    name: "Train test split",
    tag: "transform",
    x: 568,
    y: 124,
    in: ["Clean features.feature_df"],
    out: ["train_df", "test_df"],
    meta: "390 / 130 rows",
  },
  {
    id: "baseline",
    name: "Train baseline",
    tag: "transform",
    x: 326,
    y: 344,
    in: ["preprocessing:Train test split.train_df"],
    out: ["baseline_scores"],
    meta: "global linear",
  },
  {
    id: "segmented",
    name: "Train segmented model",
    tag: "transform",
    x: 326,
    y: 582,
    in: ["preprocessing:Train test split.train_df"],
    out: ["segmented_scores"],
    meta: "by channel",
  },
  {
    id: "compare",
    name: "Compare models",
    tag: "transform",
    x: 704,
    y: 394,
    in: ["model_baseline:Train baseline.baseline_scores"],
    out: ["comparison"],
    meta: "best RMSE",
  },
  {
    id: "report",
    name: "Analyst report",
    tag: "output",
    x: 884,
    y: 512,
    in: ["Compare models.comparison"],
    meta: "model report",
    chart: true,
  },
];

/** Order the run-pulse sweeps the DAG (topological). */
export const RUN_ORDER = ["load", "clean", "split", "baseline", "segmented", "compare", "report"];

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: "local" | "cross";
}

export const EDGES: GraphEdge[] = [
  { id: "e-load-clean", from: "load", to: "clean", kind: "local" },
  { id: "e-clean-split", from: "clean", to: "split", kind: "local" },
  { id: "e-split-baseline", from: "split", to: "baseline", kind: "cross" },
  { id: "e-split-segmented", from: "split", to: "segmented", kind: "cross" },
  { id: "e-baseline-compare", from: "baseline", to: "compare", kind: "cross" },
  { id: "e-segmented-compare", from: "segmented", to: "compare", kind: "cross" },
  { id: "e-compare-report", from: "compare", to: "report", kind: "local" },
];

/** The two notebook containers, as design-space rectangles. */
export interface Container {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const CONTAINERS: Container[] = [
  { id: "pre", label: "preprocessing.ipynb", x: 40, y: 88, w: 760, h: 158 },
  { id: "base", label: "model_baseline.ipynb", x: 300, y: 308, w: 260, h: 158 },
  { id: "adv", label: "model_advanced.ipynb", x: 300, y: 546, w: 260, h: 158 },
  { id: "post", label: "postprocessing.ipynb", x: 680, y: 354, w: 432, h: 250 },
];

const node = (id: string) => NODES.find((n) => n.id === id) as GraphNode;

/** Build the SVG path string for an edge between two nodes' ports. */
export function edgePath(edge: GraphEdge): string {
  const a = node(edge.from);
  const b = node(edge.to);
  if (edge.kind === "cross") {
    // Vertical-ish link: bottom-centre of `a` → top-centre of `b`.
    const ax = a.x + NODE_W / 2;
    const ay = a.y + NODE_H;
    const bx = b.x + NODE_W / 2;
    const by = b.y;
    const midy = (ay + by) / 2;
    return `M ${ax} ${ay} C ${ax} ${midy}, ${bx} ${midy}, ${bx} ${by}`;
  }
  // Horizontal link: right port of `a` → left port of `b`.
  const ax = a.x + NODE_W;
  const ay = a.y + PORT_CY;
  const bx = b.x;
  const by = b.y + PORT_CY;
  const dx = Math.max(40, (bx - ax) * 0.5);
  return `M ${ax} ${ay} C ${ax + dx} ${ay}, ${bx - dx} ${by}, ${bx} ${by}`;
}
