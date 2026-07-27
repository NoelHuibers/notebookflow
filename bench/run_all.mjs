#!/usr/bin/env node
/**
 * run_all — run both NotebookFlow performance benchmarks and write one captured
 * result file (human-readable .md + machine-readable .json) into bench/results/.
 *
 * It:
 *   1. captures machine context (OS, CPU, RAM, Node, git SHA),
 *   2. runs Benchmark 1 (SyncEngine ingest, via the graph-canvas vitest binary),
 *   3. runs Benchmark 2 (DataBus, via `uv --project engine run python`),
 *      each writing a JSON fragment to a temp file (BENCH_OUT),
 *   4. merges the fragments (pulling Python/pandas/numpy versions from the
 *      DataBus fragment) and writes bench/results/<date>-<host>.{md,json}.
 *
 * Usage:  node bench/run_all.mjs
 *         (from the repo root; requires `pnpm install` and, for Benchmark 2,
 *          the engine deps — `uv --project engine sync --extra dev`.)
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const benchDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(benchDir, "..");
const resultsDir = path.join(benchDir, "results");
mkdirSync(resultsDir, { recursive: true });

function safeGit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function isoDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function safeHost(h = os.hostname()) {
  return h.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function round(v, d = 2) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

const cpus = os.cpus();
const machine = {
  os: `${os.type()} ${os.platform()}`,
  osRelease: os.release(),
  arch: os.arch(),
  cpuModel: (cpus[0]?.model ?? "unknown").trim(),
  logicalCores: cpus.length,
  ramGiB: round(os.totalmem() / 1024 ** 3, 2),
  nodeVersion: process.version,
  v8Version: process.versions.v8,
  gitCommit: safeGit(),
  hostname: os.hostname(),
  capturedAtIso: new Date().toISOString(),
};

const tmp = mkdtempSync(path.join(os.tmpdir(), "nbf-bench-"));
const syncFragmentPath = path.join(tmp, "sync.json");
const databusFragmentPath = path.join(tmp, "databus.json");

console.log("== NotebookFlow benchmark suite ==");
console.log(`machine: ${machine.cpuModel} | ${machine.logicalCores} cores | ${machine.ramGiB} GiB`);
console.log(`node ${machine.nodeVersion} | git ${machine.gitCommit.slice(0, 12)}`);

console.log("\n[1/2] SyncEngine.ingestNotebook scaling (vitest) ...");
execFileSync(
  "pnpm",
  [
    "--filter",
    "@notebookflow/graph-canvas",
    "exec",
    "vitest",
    "run",
    "--config",
    "../../bench/vitest.sync.config.ts",
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, BENCH_OUT: syncFragmentPath },
    shell: process.platform === "win32",
  },
);

console.log("\n[2/2] DataBus intermediate-DataFrame handling (uv/python) ...");
execFileSync(
  "uv",
  ["--project", "engine", "run", "python", "bench/databus_bench.py"],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, BENCH_OUT: databusFragmentPath },
    shell: process.platform === "win32",
  },
);

const syncFragment = JSON.parse(readFileSync(syncFragmentPath, "utf8"));
const databusFragment = JSON.parse(readFileSync(databusFragmentPath, "utf8"));
rmSync(tmp, { recursive: true, force: true });

// Enrich machine context with Python-side versions captured by Benchmark 2.
const pyMachine = databusFragment.machine ?? {};
const fullMachine = {
  ...machine,
  pythonVersion: pyMachine.python_version ?? "unknown",
  pandasVersion: pyMachine.pandas_version ?? "unknown",
  numpyVersion: pyMachine.numpy_version ?? "unknown",
};

const combined = {
  suite: "notebookflow-perf",
  generatedAtIso: new Date().toISOString(),
  machine: fullMachine,
  benchmarks: {
    sync_engine_ingest: syncFragment,
    databus_dataframe: databusFragment,
  },
};

const stem = `${isoDate()}-${safeHost()}`;
const jsonPath = path.join(resultsDir, `${stem}.json`);
const mdPath = path.join(resultsDir, `${stem}.md`);
writeFileSync(jsonPath, `${JSON.stringify(combined, null, 2)}\n`, "utf8");
writeFileSync(mdPath, renderMarkdown(combined), "utf8");

console.log(`\nWrote:\n  ${jsonPath}\n  ${mdPath}`);

function renderMarkdown(c) {
  const m = c.machine;
  const sync = c.benchmarks.sync_engine_ingest;
  const bus = c.benchmarks.databus_dataframe;
  const L = [];
  L.push(`# NotebookFlow benchmark results — ${stem}`);
  L.push("");
  L.push(`_Generated ${c.generatedAtIso}. Reproduce with \`node bench/run_all.mjs\`._`);
  L.push("");
  L.push("## Machine context");
  L.push("");
  L.push("| Field | Value |");
  L.push("| --- | --- |");
  L.push(`| OS | ${m.os} ${m.osRelease} (${m.arch}) |`);
  L.push(`| CPU | ${m.cpuModel} |`);
  L.push(`| Logical cores | ${m.logicalCores} |`);
  L.push(`| RAM | ${m.ramGiB} GiB |`);
  L.push(`| Node | ${m.nodeVersion} (V8 ${m.v8Version}) |`);
  L.push(`| Python | ${m.pythonVersion} |`);
  L.push(`| pandas / numpy | ${m.pandasVersion} / ${m.numpyVersion} |`);
  L.push(`| git commit | \`${m.gitCommit}\` |`);
  L.push(`| Hostname | ${m.hostname} |`);
  L.push("");

  // Benchmark 1
  L.push("## Benchmark 1 — SyncEngine.ingestNotebook scaling");
  L.push("");
  L.push(
    `Warmups: ${sync.config.warmups}; measured repetitions: ${sync.config.reps} (median reported). ` +
      "Times in milliseconds via `performance.now()`.",
  );
  L.push("");
  L.push("| Cells | Nodes | Wires | Fresh median (ms) | Fresh min–max (ms) | Re-ingest median (ms) | Re-ingest min–max (ms) |");
  L.push("| ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const r of sync.results) {
    L.push(
      `| ${r.cells} | ${r.nodes} | ${r.wires} | ${r.freshMedianMs.toFixed(3)} | ` +
        `${r.freshMinMs.toFixed(3)}–${r.freshMaxMs.toFixed(3)} | ${r.reingestMedianMs.toFixed(3)} | ` +
        `${r.reingestMinMs.toFixed(3)}–${r.reingestMaxMs.toFixed(3)} |`,
    );
  }
  L.push("");
  L.push(
    `Scaling: ${sync.scaling.msPerCellAtMax} ms/cell at the largest size ` +
      `(${sync.results[sync.results.length - 1].cells} cells).`,
  );
  L.push("");
  L.push("Fresh-median growth ratio as size ~doubles (≈2.0 ⇒ linear, ≈4.0 ⇒ quadratic):");
  L.push("");
  L.push("| From → To cells | Fresh median ratio |");
  L.push("| --- | ---: |");
  for (const d of sync.scaling.doublingRatios) {
    L.push(`| ${d.fromCells} → ${d.toCells} | ${d.ratio} |`);
  }
  L.push("");

  // Benchmark 2
  L.push("## Benchmark 2 — DataBus intermediate-DataFrame handling");
  L.push("");
  L.push(
    `Warmups: ${bus.config.warmups}; measured repetitions: ${bus.config.reps} (median reported). ` +
      `numpy seed ${bus.config.seed}. Default spill threshold ${bus.config.default_threshold_bytes} bytes. ` +
      "Times in milliseconds via `time.perf_counter()`.",
  );
  L.push("");
  L.push("### Scenario A — single put+get latency");
  L.push("");
  L.push("| Rows | Size (MB) | Mode | Spilled | put (ms) | get (ms) | put+get median (ms) | put+get min–max (ms) |");
  L.push("| ---: | ---: | --- | --- | ---: | ---: | ---: | ---: |");
  for (const r of bus.latency) {
    L.push(
      `| ${r.rows} | ${r.size_mb} | ${r.mode} | ${r.spilled} | ${r.put_median_ms.toFixed(3)} | ` +
        `${r.get_median_ms.toFixed(3)} | ${r.putget_median_ms.toFixed(3)} | ` +
        `${r.putget_min_ms.toFixed(3)}–${r.putget_max_ms.toFixed(3)} |`,
    );
  }
  L.push("");
  L.push("Speedup (forced-spill baseline ÷ default-threshold optimization):");
  L.push("");
  L.push("| Rows | Forced-spill (ms) | Default (ms) | Speedup | Default spilled? |");
  L.push("| ---: | ---: | ---: | ---: | --- |");
  for (const s of bus.speedups) {
    L.push(
      `| ${s.rows} | ${s.forced_spill_ms.toFixed(3)} | ${s.default_ms.toFixed(3)} | ${s.speedup_x}× | ${s.default_spilled} |`,
    );
  }
  L.push("");
  const seqTrials = bus.config.sequential_trials ?? 1;
  L.push(`### Scenario B — sequential pipeline (N intermediates at 50k rows)`);
  L.push("");
  L.push(`Median of ${seqTrials} trials; peak RAM / disk are max across trials.`);
  L.push("");
  L.push("| N | Mode | Median wall (ms) | Wall min–max (ms) | Per intermediate (ms) | Peak RAM tracemalloc (MiB) | Disk used (MiB) |");
  L.push("| ---: | --- | ---: | ---: | ---: | ---: | ---: |");
  for (const r of bus.sequential) {
    const range =
      r.total_wall_min_ms !== undefined
        ? `${r.total_wall_min_ms.toFixed(2)}–${r.total_wall_max_ms.toFixed(2)}`
        : "n/a";
    L.push(
      `| ${r.n_intermediates} | ${r.mode} | ${r.total_wall_ms.toFixed(2)} | ${range} | ${r.per_intermediate_ms.toFixed(3)} | ` +
        `${r.peak_tracemalloc_mib.toFixed(2)} | ${r.disk_used_mib.toFixed(2)} |`,
    );
  }
  L.push("");
  L.push(
    "> tracemalloc traces Python-level allocations; large numpy/Arrow buffers may be under-counted, " +
      "so treat peak RAM as a lower bound. Disk = summed Parquet spill bytes. See README caveats.",
  );
  L.push("");
  return `${L.join("\n")}\n`;
}
