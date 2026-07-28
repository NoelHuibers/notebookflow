/**
 * Near-viewport detection for cell virtualization.
 *
 * Observes each cell wrapper (identified by its ``data-cell-index`` attribute)
 * with a single {@link IntersectionObserver} using a generous ``rootMargin`` so
 * cells well beyond the visible area still mount their full editor — the window
 * only demotes cells that are far off-screen, keeping scroll interactions
 * jank-free.
 *
 * Returns ``null`` to mean "treat every cell as near":
 *  - before the observer has reported anything (first paint renders all cells
 *    full, matching the pre-virtualization behavior), and
 *  - permanently when ``IntersectionObserver`` is unavailable (SSR / jsdom),
 *    so tests and server rendering never break.
 */

import type { RefObject } from "react";
import { useLayoutEffect, useState } from "react";

/** ~200% above and below the viewport — two extra screens of pre-mounted cells. */
const ROOT_MARGIN = "200% 0px 200% 0px";

export function useNearCellIndices(
  containerRef: RefObject<HTMLElement | null>,
  count: number,
): ReadonlySet<number> | null {
  // null == "all cells near". We only narrow to a concrete set once the
  // observer reports, so the very first paint mounts every editor as before.
  const [near, setNear] = useState<ReadonlySet<number> | null>(null);

  useLayoutEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      // SSR / jsdom: leave `near` as null → every cell renders full.
      return;
    }
    const root = containerRef.current;
    if (root === null) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        setNear((prev) => {
          const next = new Set<number>(prev ?? []);
          let changed = prev === null;
          for (const entry of entries) {
            const raw = entry.target.getAttribute("data-cell-index");
            if (raw === null) {
              continue;
            }
            const index = Number(raw);
            if (Number.isNaN(index)) {
              continue;
            }
            if (entry.isIntersecting) {
              if (!next.has(index)) {
                next.add(index);
                changed = true;
              }
            } else if (next.has(index)) {
              next.delete(index);
              changed = true;
            }
          }
          // Drop indices for cells that no longer exist (after a delete).
          for (const index of next) {
            if (index >= count) {
              next.delete(index);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { root: null, rootMargin: ROOT_MARGIN, threshold: 0 },
    );

    const wrappers = root.querySelectorAll<HTMLElement>("[data-cell-index]");
    for (const el of wrappers) {
      observer.observe(el);
    }
    return () => {
      observer.disconnect();
    };
    // Re-observe when the cell count changes so newly added/removed wrappers are
    // tracked; the observer's initial callback reconciles the full set.
  }, [containerRef, count]);

  return near;
}
