/**
 * Engine event formatting — turn execution events and generation metadata into
 * the short strings the inspector renders.
 *
 * i18n follows the graph-canvas labels pattern: every user-facing string is a
 * **label** with an English default, and a host overrides them by passing a
 * `labels` argument. Calling without one yields the exact English strings.
 */

import type { EngineEvent } from "./types";

export interface EventLabels {
  /** "Last generated via {backend}." */
  lastGenerated: string;
  /** "Last generated via {backend} at {when}." */
  lastGeneratedAt: string;
  /** "▶ started {pipelineId}" */
  eventStarted: string;
  /** "… {nodeId} · running" */
  eventNodeRunning: string;
  /** "{glyph} {nodeId} · {status}" */
  eventNodeCompleted: string;
  /** "{glyph} {nodeId} · {status} — {error}" */
  eventNodeCompletedWithError: string;
  /** "✓ completed ({count} nodes)" */
  eventPipelineCompleted: string;
  /** "✗ error: {message}" */
  eventError: string;
  // Per-status glyphs prefixed to nodeCompleted lines.
  glyphOk: string;
  glyphError: string;
  glyphSkipped: string;
  glyphUnknown: string;
}

// English defaults. These MUST keep producing the exact strings the web-app
// inspector rendered before the labels seam existed (see events.test.ts).
export const defaultEventLabels: EventLabels = {
  lastGenerated: "Last generated via {backend}.",
  lastGeneratedAt: "Last generated via {backend} at {when}.",
  eventStarted: "▶ started {pipelineId}",
  eventNodeRunning: "… {nodeId} · running",
  eventNodeCompleted: "{glyph} {nodeId} · {status}",
  eventNodeCompletedWithError: "{glyph} {nodeId} · {status} — {error}",
  eventPipelineCompleted: "✓ completed ({count} nodes)",
  eventError: "✗ error: {message}",
  glyphOk: "✓",
  glyphError: "✗",
  glyphSkipped: "↷",
  glyphUnknown: "•",
};

/** Single-pass `{token}` substitution so replacement values are never re-scanned. */
function format(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}

export function buildGenerationStatus(
  metadata: {
    lastGeneratedAt?: string;
    lastGenerationBackend?: string;
  },
  labels: EventLabels = defaultEventLabels,
): string | null {
  if (metadata.lastGenerationBackend === undefined && metadata.lastGeneratedAt === undefined) {
    return null;
  }
  const backend = metadata.lastGenerationBackend ?? "template";
  if (metadata.lastGeneratedAt === undefined) {
    return format(labels.lastGenerated, { backend });
  }
  const when = new Date(metadata.lastGeneratedAt).toLocaleString();
  return format(labels.lastGeneratedAt, { backend, when });
}

export function renderEvent(event: EngineEvent, labels: EventLabels = defaultEventLabels): string {
  switch (event.type) {
    case "executionStarted":
      return format(labels.eventStarted, { pipelineId: event.pipelineId });
    case "nodeStarted":
      return format(labels.eventNodeRunning, { nodeId: event.nodeId });
    case "nodeCompleted": {
      const vars = {
        glyph: statusGlyph(event.result.status, labels),
        nodeId: event.result.nodeId,
        status: event.result.status,
      };
      return event.result.error
        ? format(labels.eventNodeCompletedWithError, { ...vars, error: event.result.error })
        : format(labels.eventNodeCompleted, vars);
    }
    case "pipelineCompleted":
      return format(labels.eventPipelineCompleted, { count: String(event.results.length) });
    case "error":
      return format(labels.eventError, { message: event.message });
  }
}

export function statusGlyph(status: string, labels: EventLabels = defaultEventLabels): string {
  if (status === "ok") {
    return labels.glyphOk;
  }
  if (status === "error") {
    return labels.glyphError;
  }
  if (status === "skipped") {
    return labels.glyphSkipped;
  }
  return labels.glyphUnknown;
}
