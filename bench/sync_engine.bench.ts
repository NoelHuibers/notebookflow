/**
 * Benchmark 1 — SyncEngine.ingestNotebook scaling.
 *
 * WHAT: `SyncEngine.ingestNotebook` (packages/graph-canvas/src/sync/SyncEngine.ts)
 * is the core notebook -> graph sync. It reparses every cell's `# @node:` marker,
 * rebuilds the node graph for the notebook, and resolves every contract-binding
 * wire across the workspace (`recomputeAllWires`). It runs on every notebook
 * save (fresh ingest) and, for editor adapters, on every keystroke in a marker
 * cell (re-ingest of the same array with one cell's source changed). Its cost
 * therefore sits directly on the interactive-latency path, so its scaling in the
 * number of cells is the claim we measure.
 *
 * HOW: we generate valid synthetic notebooks (see generateNotebook) sized
 * [10..3200] cells, and for each size measure the median (of REPS, after WARMUPS)
 * wall-clock time of:
 *   - fresh ingest: a brand-new SyncEngine ingesting the whole notebook once, and
 *   - re-ingest:    an already-populated engine re-ingesting the same notebook
 *                   with a single cell's body mutated (the every-keystroke path).
 * Timing uses performance.now() around a single awaited ingestNotebook() call;
 * notebook generation and graph inspection are excluded from the timed region.
 *
 * Determinism: the notebook shape is a pure function of the cell index (no
 * Math.random). Callbacks are no-ops so we measure the engine, not an adapter.
 *
 * Run:  see bench/README.md ("How to run"). This file lives under bench/ and is
 * NOT matched by the graph-canvas vitest include glob (src/**), so `pnpm test`
 * never runs it; it is executed via bench/vitest.sync.config.ts.
 */

import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { test } from "vitest";
import type { NotebookCell } from "../packages/graph-canvas/src/sync/MarkerParser";
import { SyncEngine } from "../packages/graph-canvas/src/sync/SyncEngine";
import {
  captureMachineContext,
  isoDate,
  max,
  median,
  min,
  round,
  safeHost,
} from "./lib/bench-util";

const NOTEBOOK_PATH = "bench.ipynb";
const SIZES = [10, 25, 50, 100, 200, 400, 800, 1600, 3200] as const;
const WARMUPS = 5;
const REPS = 15; // odd, >= 7 measured repetitions -> a true median (extra reps damp CPU-freq noise)

/**
 * Build a valid synthetic notebook of `cellCount` cells.
 *
 * ~80% marker cells + ~20% markerless filler (deterministic: every 5th cell,
 * index % 5 === 4, is filler). Each marker cell's first line is a canonical
 * single-line `# @node:` marker; every marker node wires to its immediate
 * marker predecessor via `in=inp<-Prev.out`, and declares `out=out` so the
 * predecessor reference resolves. The result is a fully-wired linear chain of
 * (0.8 * cellCount) nodes with (nodes - 1) resolvable wires.
 */
function generateNotebook(cellCount: number): NotebookCell[] {
  const cells: NotebookCell[] = [];
  let markerCount = 0;
  let prevNodeName: string | null = null;
  for (let i = 0; i < cellCount; i++) {
    const isFiller = i % 5 === 4;
    if (isFiller) {
      // Markerless code cell: first line is a plain comment, not a `# @node:`.
      cells.push({
        cellType: "code",
        source: `# filler cell ${i}\nimport math\nvalue_${i} = math.sqrt(${i})\n`,
      });
      continue;
    }
    const name = `Node${markerCount}`;
    const marker =
      prevNodeName === null
        ? `# @node: ${name}  [input]  out=out`
        : `# @node: ${name}  [transform]  in=inp<-${prevNodeName}.out  out=out`;
    const body = `x_${i} = ${i}\nresult = x_${i} + ${markerCount}\n# step ${markerCount}`;
    cells.push({ cellType: "code", source: `${marker}\n${body}` });
    prevNodeName = name;
    markerCount += 1;
  }
  return cells;
}

/** A fresh SyncEngine with no-op adapter callbacks. */
function makeEngine(): SyncEngine {
  return new SyncEngine({
    onCellPatch: async () => {
      /* no-op: ingest never patches cells */
    },
    onGraphUpdate: () => {
      /* no-op: exclude adapter render cost from the measurement */
    },
  });
}

interface SizeResult {
  cells: number;
  nodes: number;
  wires: number;
  freshMedianMs: number;
  freshMinMs: number;
  freshMaxMs: number;
  reingestMedianMs: number;
  reingestMinMs: number;
  reingestMaxMs: number;
}

async function measureSize(cellCount: number): Promise<SizeResult> {
  const cells = generateNotebook(cellCount);

  // --- Graph shape (outside the timed region) ---
  const probe = makeEngine();
  await probe.ingestNotebook(NOTEBOOK_PATH, cells, Date.now());
  const graph = probe.getGraph();
  const nodes = Object.keys(graph.nodes).length;
  const wires = Object.keys(graph.wires).length;

  // --- Fresh ingest: a brand-new engine per rep ---
  for (let w = 0; w < WARMUPS; w++) {
    const e = makeEngine();
    await e.ingestNotebook(NOTEBOOK_PATH, cells, Date.now());
  }
  const freshSamples: number[] = [];
  for (let r = 0; r < REPS; r++) {
    const e = makeEngine();
    const t0 = performance.now();
    await e.ingestNotebook(NOTEBOOK_PATH, cells, Date.now());
    freshSamples.push(performance.now() - t0);
  }

  // --- Re-ingest: one warm engine, one marker cell's body mutated per rep ---
  // This is the every-keystroke path: the whole cell array is re-ingested after
  // a single cell changed. We mutate a marker cell near the middle so the change
  // sits inside the chain, not at an end.
  const reEngine = makeEngine();
  await reEngine.ingestNotebook(NOTEBOOK_PATH, cells, Date.now());
  const mutIndex = pickMiddleMarkerIndex(cells);
  const baseSource = cells[mutIndex]?.source ?? "";
  const mutate = (n: number): void => {
    // Append a comment line -> the marker (first line) is unchanged, the graph
    // is identical, but the source genuinely differs each rep (no no-op skip).
    cells[mutIndex] = { cellType: "code", source: `${baseSource}\n# edit ${n}` };
  };
  for (let w = 0; w < WARMUPS; w++) {
    mutate(-1 - w);
    await reEngine.ingestNotebook(NOTEBOOK_PATH, cells, Date.now());
  }
  const reSamples: number[] = [];
  for (let r = 0; r < REPS; r++) {
    mutate(r);
    const t0 = performance.now();
    await reEngine.ingestNotebook(NOTEBOOK_PATH, cells, Date.now());
    reSamples.push(performance.now() - t0);
  }

  return {
    cells: cellCount,
    nodes,
    wires,
    freshMedianMs: round(median(freshSamples)),
    freshMinMs: round(min(freshSamples)),
    freshMaxMs: round(max(freshSamples)),
    reingestMedianMs: round(median(reSamples)),
    reingestMinMs: round(min(reSamples)),
    reingestMaxMs: round(max(reSamples)),
  };
}

/** Index of a marker cell near the middle of the notebook. */
function pickMiddleMarkerIndex(cells: NotebookCell[]): number {
  const target = Math.floor(cells.length / 2);
  for (let d = 0; d < cells.length; d++) {
    for (const idx of [target + d, target - d]) {
      if (idx >= 0 && idx < cells.length && cells[idx]?.source.startsWith("# @node:")) {
        return idx;
      }
    }
  }
  return 0;
}

/** ms-per-cell and the doubling ratio, to characterise the scaling. */
function characterize(results: SizeResult[]): {
  msPerCellAtMax: number;
  doublingRatios: { fromCells: number; toCells: number; ratio: number }[];
} {
  const largest = results[results.length - 1] as SizeResult;
  const doublingRatios: { fromCells: number; toCells: number; ratio: number }[] = [];
  for (let i = 1; i < results.length; i++) {
    const prev = results[i - 1] as SizeResult;
    const cur = results[i] as SizeResult;
    // Sizes roughly double each step; report the fresh-median growth ratio.
    doublingRatios.push({
      fromCells: prev.cells,
      toCells: cur.cells,
      ratio: prev.freshMedianMs > 0 ? round(cur.freshMedianMs / prev.freshMedianMs, 3) : 0,
    });
  }
  return {
    msPerCellAtMax: round(largest.freshMedianMs / largest.cells, 6),
    doublingRatios,
  };
}

test("SyncEngine.ingestNotebook scaling", { timeout: 600_000 }, async () => {
  const machine = captureMachineContext();
  const results: SizeResult[] = [];
  for (const size of SIZES) {
    const r = await measureSize(size);
    results.push(r);
    // Human-readable progress line (also useful when run standalone).
    // eslint-disable-next-line no-console
    console.log(
      `cells=${String(r.cells).padStart(4)}  nodes=${String(r.nodes).padStart(4)}  ` +
        `wires=${String(r.wires).padStart(4)}  fresh=${r.freshMedianMs.toFixed(3)}ms  ` +
        `re-ingest=${r.reingestMedianMs.toFixed(3)}ms`,
    );
  }
  const scaling = characterize(results);

  const fragment = {
    benchmark: "sync_engine_ingest",
    machine,
    config: { sizes: SIZES, warmups: WARMUPS, reps: REPS, notebookPath: NOTEBOOK_PATH },
    results,
    scaling,
  };

  const outPath =
    process.env.BENCH_OUT ??
    fileURLToPath(
      new URL(
        `./results/${isoDate()}-${safeHost()}-sync.fragment.json`,
        import.meta.url,
      ),
    );
  writeFileSync(outPath, `${JSON.stringify(fragment, null, 2)}\n`, "utf8");
  // eslint-disable-next-line no-console
  console.log(`\n[sync bench] wrote fragment -> ${outPath}`);
  // eslint-disable-next-line no-console
  console.log(
    `[sync bench] ms/cell at ${results[results.length - 1]?.cells} cells = ${scaling.msPerCellAtMax}`,
  );
});
