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

/**
 * The authentic demo pipeline (examples/demo.ipynb): a 4-node chain in
 * pipeline.ipynb, plus one cross-notebook AI node in model.ipynb.
 */
export const NODES: GraphNode[] = [
  { id: "load", name: "Load Data", tag: "input", x: 64, y: 150, out: ["df"], meta: "demo.csv · 6 rows" },
  { id: "filter", name: "Filter", tag: "transform", x: 336, y: 150, in: ["Load Data.df"], out: ["clean_df"], meta: "5 rows" },
  { id: "summarize", name: "Summarize", tag: "transform", x: 608, y: 150, in: ["Filter.clean_df"], out: ["by_region"], meta: "3 rows" },
  { id: "report", name: "Report", tag: "output", x: 880, y: 150, in: ["Summarize.by_region"], meta: "by region", chart: true },
  { id: "forecast", name: "Forecast", tag: "ai", x: 608, y: 470, in: ["data:Summarize.by_region"], out: ["trend"], meta: "model.ipynb" },
];

/** Order the run-pulse sweeps the DAG (topological). */
export const RUN_ORDER = ["load", "filter", "summarize", "report", "forecast"];

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: "local" | "cross";
}

export const EDGES: GraphEdge[] = [
  { id: "e-load-filter", from: "load", to: "filter", kind: "local" },
  { id: "e-filter-summarize", from: "filter", to: "summarize", kind: "local" },
  { id: "e-summarize-report", from: "summarize", to: "report", kind: "local" },
  { id: "e-summarize-forecast", from: "summarize", to: "forecast", kind: "cross" },
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
  { id: "a", label: "pipeline.ipynb", x: 40, y: 108, w: 1072, h: 158 },
  { id: "b", label: "model.ipynb", x: 584, y: 430, w: 256, h: 158 },
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
