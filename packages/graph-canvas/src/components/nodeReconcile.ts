/**
 * nodeReconcile — preserve React Flow node object identity across rebuilds.
 *
 * `buildNodes` rebuilds the ENTIRE node array (fresh `data` objects) whenever
 * any overlay map changes — a single runtime-status event therefore hands React
 * Flow N brand-new node objects, defeating its per-node memo and re-rendering
 * every node on the canvas.
 *
 * `reconcileNodes` diffs the freshly-built array against the previous one and
 * reuses the previous object reference for any node whose content is deeply
 * unchanged. The returned array is value-identical to `next` (same length,
 * order, ids, and per-node content) — only object identities are preserved for
 * untouched nodes, so React Flow can skip re-rendering them. Behaviour is
 * unchanged; the sole observable effect is fewer re-renders.
 */

import type { Node } from "reactflow";

/**
 * Structural deep-equality tuned for React Flow node objects.
 *
 * - primitives compare by value;
 * - functions compare by reference (callback props are stable via the host's
 *   `useCallback`; a changed reference conservatively counts as "different",
 *   which only causes a rebuild — never stale reuse);
 * - arrays/plain objects compare recursively.
 *
 * The conservative failure mode is a false "not equal" (rebuild anyway, exactly
 * as today), never a false "equal" (which would reuse a stale node).
 */
export function deepEqualValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  // Different function references (=== already handled the same ref) — treat as
  // changed. Bailing here keeps us conservative rather than risking staleness.
  if (typeof a === "function" || typeof b === "function") {
    return false;
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) {
    return false;
  }
  if (aIsArray && bIsArray) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEqualValue(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (!Object.hasOwn(bObj, key)) {
      return false;
    }
    if (!deepEqualValue(aObj[key], bObj[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Return an array value-identical to `next`, but with each node object replaced
 * by the matching `prev` node (same id) when the two are deeply equal. Falls
 * back to the freshly-built node whenever anything differs or no prior node
 * exists.
 */
export function reconcileNodes(prev: readonly Node[], next: readonly Node[]): Node[] {
  if (prev.length === 0) {
    return next as Node[];
  }
  const prevById = new Map<string, Node>();
  for (const node of prev) {
    prevById.set(node.id, node);
  }
  let reusedCount = 0;
  const result = next.map((node) => {
    const previous = prevById.get(node.id);
    if (previous !== undefined && deepEqualValue(previous, node)) {
      reusedCount += 1;
      return previous;
    }
    return node;
  });
  // If nothing was reused, hand back the original `next` array so callers that
  // compare array identity see a genuinely new array (matches prior behaviour).
  if (reusedCount === 0) {
    return next as Node[];
  }
  return result;
}
