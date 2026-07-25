// @vitest-environment jsdom

/**
 * Guards LandingHero's GSAP timeline against markup drift: every selector the
 * timeline animates must match the markup GraphScene actually renders,
 * otherwise GSAP logs "target not found" in the console and the beat silently
 * no-ops (this happened when the scene was rebuilt around the multi-notebook
 * analyst pipeline: `data-node="forecast"` / `data-c="a|b"` no longer existed).
 *
 * Scope: GraphScene renders every graph-stage element (nodes, ports, wires,
 * containers, pill, source card) with plain DOM/SVG — no three.js, so it runs
 * headless in jsdom. The full LandingHero is not rendered here because it needs
 * a TanStack router context (Link) and the R3F backdrop; its own overlay
 * selectors (.nf-cap / .nf-scrollcue) live in the same file as the timeline,
 * so they cannot drift across files the way the graph-data-driven ones did.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n";
import { GraphScene } from "./GraphScene";
import { CONTAINERS, EDGES, NODES, RUN_ORDER } from "./graph-data";
import { GRAPH_STAGE_SELECTORS } from "./hero-selectors";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <I18nProvider locale="en">
        <GraphScene />
      </I18nProvider>,
    );
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("hero timeline selectors", () => {
  it("every selector the GSAP timeline animates matches rendered GraphScene markup", () => {
    // Combined selectors ("a, b") would pass querySelector if only one part
    // matched — split them so every single part must hit an element.
    const parts = GRAPH_STAGE_SELECTORS.flatMap((sel) => sel.split(",").map((s) => s.trim()));
    expect(parts.length).toBeGreaterThan(0);
    const misses = parts.filter((sel) => container.querySelector(sel) === null);
    expect(misses).toEqual([]);
  });

  it("every data-node the run pulse references exists in graph-data", () => {
    const ids = new Set(NODES.map((n) => n.id));
    for (const id of RUN_ORDER) expect(ids).toContain(id);
  });

  it("graph-data is internally consistent (edges and containers reference real ids)", () => {
    const nodeIds = new Set(NODES.map((n) => n.id));
    const containerIds = new Set(CONTAINERS.map((c) => c.id));
    for (const e of EDGES) {
      expect(nodeIds).toContain(e.from);
      expect(nodeIds).toContain(e.to);
    }
    for (const n of NODES) expect(containerIds).toContain(n.container);
  });
});
