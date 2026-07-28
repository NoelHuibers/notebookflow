/**
 * runDeltas — "what changed since the previous run?" for the canvas meta line.
 *
 * The baseline is the previous pipeline run of the current session, held in
 * memory only (App snapshots the live maps immediately before the run-start
 * wipe). Reloading the page resets the comparison; nothing is persisted.
 *
 * Rules, deliberately conservative so the canvas stays quiet:
 *
 * - A delta is emitted only when BOTH sides have a value for that node. No
 *   baseline (first run of a session, or a node that is new this run) and no
 *   current value (a node that didn't run, or reported no rows) both mean
 *   "no delta" — never a synthetic 0.
 * - Equal values produce no delta, so an unchanged node shows no chrome.
 * - Duration is noisy: process scheduling, disk cache and JIT warmup move a
 *   sub-100ms cell around by tens of milliseconds between identical runs.
 *   Differences smaller than DURATION_DELTA_THRESHOLD_MS (50ms) are treated as
 *   noise and dropped; the surviving delta is rounded to whole milliseconds.
 *   50ms is also roughly the floor of what a human perceives as "slower", and
 *   it is below one tick of the canvas's own 0.1s duration display, so any
 *   delta we do show is at least visible in the rendered numbers.
 * - Row counts are exact integers from the engine, so they use no threshold.
 * - Status changes only count between TERMINAL states (ok / error / skipped).
 *   `idle`/`queued`/`running` are transient — comparing against them would
 *   flash a bogus "queued → ok" on every node as a run progresses.
 */

import type { RuntimeState } from "@notebookflow/graph-canvas";

/** Duration differences below this (ms) are treated as measurement noise. */
export const DURATION_DELTA_THRESHOLD_MS = 50;

const TERMINAL_STATES: readonly RuntimeState[] = ["ok", "error", "skipped"];

/** One side of the comparison: the per-node maps App already keeps. */
export interface RunSnapshot {
  /** Output row counts by node id. */
  rowsByNode: Record<string, number>;
  /** Last-run durations in ms by node id. */
  timingByNode: Record<string, number>;
  /** Runtime status by node id. */
  runtimeByNode: Record<string, RuntimeState>;
}

/** No baseline yet — the state of things before the first run of a session. */
export const EMPTY_RUN_SNAPSHOT: RunSnapshot = {
  rowsByNode: {},
  timingByNode: {},
  runtimeByNode: {},
};

/** A node's result relative to the previous run. Absent fields mean "no change". */
export interface NodeRunDelta {
  /** Signed row-count change (never 0). */
  rowsDelta?: number;
  /** Signed duration change in ms (never 0, always past the noise threshold). */
  durationDeltaMs?: number;
  /** Terminal status transition, e.g. ok → error. */
  statusChanged?: { from: RuntimeState; to: RuntimeState };
}

function isTerminal(state: RuntimeState | undefined): state is RuntimeState {
  return state !== undefined && TERMINAL_STATES.includes(state);
}

function numericDelta(
  previous: number | undefined,
  current: number | undefined,
  thresholdMs: number,
): number | undefined {
  if (previous === undefined || current === undefined) {
    return undefined;
  }
  if (!Number.isFinite(previous) || !Number.isFinite(current)) {
    return undefined;
  }
  const delta = Math.round(current - previous);
  if (delta === 0 || Math.abs(delta) < thresholdMs) {
    return undefined;
  }
  return delta;
}

/** Deltas for a single node. Returns an empty object when nothing changed. */
export function computeNodeRunDelta(
  previous: RunSnapshot,
  current: RunSnapshot,
  nodeId: string,
): NodeRunDelta {
  const delta: NodeRunDelta = {};

  const rowsDelta = numericDelta(previous.rowsByNode[nodeId], current.rowsByNode[nodeId], 1);
  if (rowsDelta !== undefined) {
    delta.rowsDelta = rowsDelta;
  }

  const durationDelta = numericDelta(
    previous.timingByNode[nodeId],
    current.timingByNode[nodeId],
    DURATION_DELTA_THRESHOLD_MS,
  );
  if (durationDelta !== undefined) {
    delta.durationDeltaMs = durationDelta;
  }

  const from = previous.runtimeByNode[nodeId];
  const to = current.runtimeByNode[nodeId];
  if (isTerminal(from) && isTerminal(to) && from !== to) {
    delta.statusChanged = { from, to };
  }

  return delta;
}

/** True when a delta carries nothing worth rendering. */
export function isEmptyRunDelta(delta: NodeRunDelta): boolean {
  return (
    delta.rowsDelta === undefined &&
    delta.durationDeltaMs === undefined &&
    delta.statusChanged === undefined
  );
}

/**
 * Deltas for every node that has one. Nodes with nothing to report are absent
 * from the result, so `{}` means "first run of the session" or "nothing moved".
 */
export function computeRunDeltas(
  previous: RunSnapshot,
  current: RunSnapshot,
): Record<string, NodeRunDelta> {
  const nodeIds = new Set<string>([
    ...Object.keys(current.rowsByNode),
    ...Object.keys(current.timingByNode),
    ...Object.keys(current.runtimeByNode),
  ]);
  const result: Record<string, NodeRunDelta> = {};
  for (const nodeId of nodeIds) {
    const delta = computeNodeRunDelta(previous, current, nodeId);
    if (!isEmptyRunDelta(delta)) {
      result[nodeId] = delta;
    }
  }
  return result;
}
