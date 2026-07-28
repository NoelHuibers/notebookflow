import { describe, expect, it } from "vitest";

import type { RunSnapshot } from "./runDeltas";
import { computeRunDeltas, DURATION_DELTA_THRESHOLD_MS } from "./runDeltas";

const EMPTY: RunSnapshot = { rowsByNode: {}, timingByNode: {}, runtimeByNode: {} };

function snapshot(partial: Partial<RunSnapshot>): RunSnapshot {
  return { ...EMPTY, ...partial };
}

describe("computeRunDeltas", () => {
  it("returns no deltas when there is no baseline (first run of a session)", () => {
    const current = snapshot({
      rowsByNode: { a: 1204 },
      timingByNode: { a: 1200 },
      runtimeByNode: { a: "ok" },
    });
    expect(computeRunDeltas(EMPTY, current)).toEqual({});
  });

  it("returns no deltas when nothing changed", () => {
    const run = snapshot({
      rowsByNode: { a: 1204 },
      timingByNode: { a: 1200 },
      runtimeByNode: { a: "ok" },
    });
    expect(computeRunDeltas(run, run)).toEqual({});
  });

  it("reports a positive row delta", () => {
    const previous = snapshot({ rowsByNode: { a: 1192 } });
    const current = snapshot({ rowsByNode: { a: 1204 } });
    expect(computeRunDeltas(previous, current)).toEqual({ a: { rowsDelta: 12 } });
  });

  it("reports a negative row delta", () => {
    const previous = snapshot({ rowsByNode: { a: 1204 } });
    const current = snapshot({ rowsByNode: { a: 1200 } });
    expect(computeRunDeltas(previous, current)).toEqual({ a: { rowsDelta: -4 } });
  });

  it("reports a faster duration as a negative delta", () => {
    const previous = snapshot({ timingByNode: { a: 1600 } });
    const current = snapshot({ timingByNode: { a: 1200 } });
    expect(computeRunDeltas(previous, current)).toEqual({ a: { durationDeltaMs: -400 } });
  });

  it("reports a slower duration as a positive delta", () => {
    const previous = snapshot({ timingByNode: { a: 1200 } });
    const current = snapshot({ timingByNode: { a: 1600 } });
    expect(computeRunDeltas(previous, current)).toEqual({ a: { durationDeltaMs: 400 } });
  });

  it("ignores sub-threshold duration noise", () => {
    const previous = snapshot({ timingByNode: { a: 1200 } });
    const current = snapshot({ timingByNode: { a: 1200 + DURATION_DELTA_THRESHOLD_MS - 1 } });
    expect(computeRunDeltas(previous, current)).toEqual({});
  });

  it("keeps a duration delta exactly at the threshold", () => {
    const previous = snapshot({ timingByNode: { a: 1200 } });
    const current = snapshot({ timingByNode: { a: 1200 + DURATION_DELTA_THRESHOLD_MS } });
    expect(computeRunDeltas(previous, current)).toEqual({
      a: { durationDeltaMs: DURATION_DELTA_THRESHOLD_MS },
    });
  });

  it("rounds fractional durations to whole milliseconds", () => {
    const previous = snapshot({ timingByNode: { a: 100.4 } });
    const current = snapshot({ timingByNode: { a: 220.9 } });
    expect(computeRunDeltas(previous, current)).toEqual({ a: { durationDeltaMs: 121 } });
  });

  it("reports an ok → error status change", () => {
    const previous = snapshot({ runtimeByNode: { a: "ok" } });
    const current = snapshot({ runtimeByNode: { a: "error" } });
    expect(computeRunDeltas(previous, current)).toEqual({
      a: { statusChanged: { from: "ok", to: "error" } },
    });
  });

  it("reports an error → ok status change", () => {
    const previous = snapshot({ runtimeByNode: { a: "error" } });
    const current = snapshot({ runtimeByNode: { a: "ok" } });
    expect(computeRunDeltas(previous, current)).toEqual({
      a: { statusChanged: { from: "error", to: "ok" } },
    });
  });

  it("reports an ok → skipped status change", () => {
    const previous = snapshot({ runtimeByNode: { a: "ok" } });
    const current = snapshot({ runtimeByNode: { a: "skipped" } });
    expect(computeRunDeltas(previous, current)).toEqual({
      a: { statusChanged: { from: "ok", to: "skipped" } },
    });
  });

  it("ignores non-terminal statuses on either side", () => {
    const queuedNow = computeRunDeltas(
      snapshot({ runtimeByNode: { a: "ok" } }),
      snapshot({ runtimeByNode: { a: "queued" } }),
    );
    expect(queuedNow).toEqual({});

    const idleBefore = computeRunDeltas(
      snapshot({ runtimeByNode: { a: "idle" } }),
      snapshot({ runtimeByNode: { a: "ok" } }),
    );
    expect(idleBefore).toEqual({});

    const runningNow = computeRunDeltas(
      snapshot({ runtimeByNode: { a: "error" } }),
      snapshot({ runtimeByNode: { a: "running" } }),
    );
    expect(runningNow).toEqual({});
  });

  it("omits a node that is absent from the previous run", () => {
    const previous = snapshot({ rowsByNode: { a: 10 }, timingByNode: { a: 100 } });
    const current = snapshot({
      rowsByNode: { a: 10, b: 55 },
      timingByNode: { a: 100, b: 900 },
      runtimeByNode: { b: "ok" },
    });
    expect(computeRunDeltas(previous, current)).toEqual({});
  });

  it("omits a node that is absent from the current run", () => {
    const previous = snapshot({
      rowsByNode: { a: 10, b: 55 },
      timingByNode: { a: 100, b: 900 },
      runtimeByNode: { a: "ok", b: "ok" },
    });
    const current = snapshot({
      rowsByNode: { a: 42 },
      timingByNode: { a: 100 },
      runtimeByNode: { a: "ok" },
    });
    expect(computeRunDeltas(previous, current)).toEqual({ a: { rowsDelta: 32 } });
  });

  it("combines row, duration and status changes for one node", () => {
    const previous = snapshot({
      rowsByNode: { a: 1000 },
      timingByNode: { a: 2000 },
      runtimeByNode: { a: "error" },
    });
    const current = snapshot({
      rowsByNode: { a: 1204 },
      timingByNode: { a: 1200 },
      runtimeByNode: { a: "ok" },
    });
    expect(computeRunDeltas(previous, current)).toEqual({
      a: {
        rowsDelta: 204,
        durationDeltaMs: -800,
        statusChanged: { from: "error", to: "ok" },
      },
    });
  });

  it("ignores non-finite values", () => {
    const previous = snapshot({ rowsByNode: { a: Number.NaN }, timingByNode: { a: 100 } });
    const current = snapshot({
      rowsByNode: { a: 10 },
      timingByNode: { a: Number.POSITIVE_INFINITY },
    });
    expect(computeRunDeltas(previous, current)).toEqual({});
  });
});
