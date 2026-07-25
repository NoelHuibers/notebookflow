/**
 * Every graph-stage selector LandingHero's GSAP timeline animates, derived
 * from graph-data so a data/markup rebuild cannot silently orphan a tween
 * (GSAP logs "target not found" and the beat no-ops — exactly what happened
 * when the scene moved to the multi-notebook analyst pipeline).
 *
 * hero-selectors.test.tsx renders GraphScene and asserts each selector
 * matches real markup.
 */
import { CONTAINERS, EDGES, type GraphNode, NODES, RUN_ORDER } from "./graph-data";

/** The notebook the hero source card portrays; its cells lift into nodes in act 2. */
export const SOURCE_CONTAINER_ID = "pre";

const sourceNodeIds = NODES.filter((n) => n.container === SOURCE_CONTAINER_ID).map((n) => n.id);
const linkedNodeIds = NODES.filter((n) => n.container !== SOURCE_CONTAINER_ID).map((n) => n.id);
const isSourceNode = (id: string): boolean => sourceNodeIds.includes(id);

const nodeSel = (ids: string[]): string =>
  ids.map((id) => `.nf-node[data-node="${id}"]`).join(", ");

/** Only the port dots GraphScene actually renders (in-port iff `in`, out-port iff `out`). */
const portSel = (ids: string[]): string =>
  NODES.filter((n: GraphNode) => ids.includes(n.id))
    .flatMap((n) => [
      ...(n.in?.length ? [`.nf-port[data-node-side="${n.id}-in"]`] : []),
      ...(n.out?.length ? [`.nf-port[data-node-side="${n.id}-out"]`] : []),
    ])
    .join(", ");

const containerSel = (ids: string[]): string =>
  ids.map((id) => `.nf-container[data-c="${id}"]`).join(", ");

const wireSel = (ids: string[]): string =>
  ids.map((id) => `.nf-wire[data-edge="${id}"]`).join(", ");

// ---- Act 2 — the source notebook's own cells become nodes -----------------
export const SOURCE_NODES_SELECTOR: string = nodeSel(sourceNodeIds);
export const SOURCE_PORTS_SELECTOR: string = portSel(sourceNodeIds);
export const SOURCE_CONTAINER_SELECTOR: string = containerSel([SOURCE_CONTAINER_ID]);
/** Local wires fully inside the source notebook — drawn on in act 2. */
export const SOURCE_WIRES_SELECTOR: string = wireSel(
  EDGES.filter((e) => e.kind === "local" && isSourceNode(e.from) && isSourceNode(e.to)).map(
    (e) => e.id,
  ),
);

// ---- Act 3 — the downstream notebooks link in ------------------------------
export const LINKED_NODES_SELECTOR: string = nodeSel(linkedNodeIds);
export const LINKED_PORTS_SELECTOR: string = portSel(linkedNodeIds);
export const LINKED_CONTAINERS_SELECTOR: string = containerSel(
  CONTAINERS.filter((c) => c.id !== SOURCE_CONTAINER_ID).map((c) => c.id),
);
/** Local wires of the linked notebooks — drawn on after they arrive. */
export const LINKED_LOCAL_WIRES_SELECTOR: string = wireSel(
  EDGES.filter((e) => e.kind === "local" && !(isSourceNode(e.from) && isSourceNode(e.to))).map(
    (e) => e.id,
  ),
);

// ---- Act 4 — the run pulse, in topological order ---------------------------
export const RUN_STATUS_SELECTORS: string[] = RUN_ORDER.map(
  (id) => `.nf-status[data-node="${id}"]`,
);

/**
 * Everything the timeline targets inside GraphScene. The test splits combined
 * selectors on commas and asserts each part matches at least one element.
 */
export const GRAPH_STAGE_SELECTORS: string[] = [
  ".nf-stage",
  ".nf-source",
  ".nf-node",
  ".nf-port",
  ".nf-container",
  ".nf-pill",
  ".nf-bar",
  ".nf-status",
  ".nf-wire",
  ".nf-wire-local",
  ".nf-wire-cross",
  SOURCE_NODES_SELECTOR,
  SOURCE_PORTS_SELECTOR,
  SOURCE_CONTAINER_SELECTOR,
  SOURCE_WIRES_SELECTOR,
  LINKED_NODES_SELECTOR,
  LINKED_PORTS_SELECTOR,
  LINKED_CONTAINERS_SELECTOR,
  LINKED_LOCAL_WIRES_SELECTOR,
  ...RUN_STATUS_SELECTORS,
];
