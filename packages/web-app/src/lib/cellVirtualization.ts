/**
 * Cell virtualization policy — the pure decision for whether a cell renders its
 * full (live CodeMirror) editor or the lightweight read-only fallback.
 *
 * Extracted as a side-effect-free function so the windowing rules can be unit
 * tested without a DOM. The near-viewport set is produced by
 * {@link useNearIndices} (IntersectionObserver); the focused and streaming cells
 * are always kept full so editing focus and live output never land on a demoted
 * cell.
 */

export interface RenderPolicyContext {
  /** Indices detected as at/near the viewport by the IntersectionObserver hook. */
  nearIndices: ReadonlySet<number>;
  /** The currently focused cell — must never demote (holds the caret). */
  focusedCellIndex?: number | null | undefined;
  /** The cell whose node is executing — must never demote (streams output). */
  streamingCellIndex?: number | null | undefined;
}

/**
 * Whether cell ``index`` should mount the full CodeMirror editor.
 *
 * True when the cell is near the viewport, is the focused cell, or is the
 * streaming cell. Otherwise the cell renders the read-only fallback.
 */
export function shouldRenderFullEditor(index: number, ctx: RenderPolicyContext): boolean {
  const { nearIndices, focusedCellIndex, streamingCellIndex } = ctx;
  if (nearIndices.has(index)) {
    return true;
  }
  if (focusedCellIndex !== null && focusedCellIndex !== undefined && index === focusedCellIndex) {
    return true;
  }
  if (
    streamingCellIndex !== null &&
    streamingCellIndex !== undefined &&
    index === streamingCellIndex
  ) {
    return true;
  }
  return false;
}
