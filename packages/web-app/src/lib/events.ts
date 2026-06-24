/**
 * Engine event formatting — turn execution events and generation metadata into
 * the short strings the inspector renders.
 */

import type { EngineEvent } from "./EngineClient";

export function buildGenerationStatus(metadata: {
  lastGeneratedAt?: string;
  lastGenerationBackend?: string;
}): string | null {
  if (metadata.lastGenerationBackend === undefined && metadata.lastGeneratedAt === undefined) {
    return null;
  }
  if (metadata.lastGeneratedAt === undefined) {
    return `Last generated via ${metadata.lastGenerationBackend ?? "template"}.`;
  }
  const when = new Date(metadata.lastGeneratedAt).toLocaleString();
  return `Last generated via ${metadata.lastGenerationBackend ?? "template"} at ${when}.`;
}

export function renderEvent(event: EngineEvent): string {
  switch (event.type) {
    case "executionStarted":
      return `▶ started ${event.pipelineId}`;
    case "nodeStarted":
      return `… ${event.nodeId} · running`;
    case "nodeCompleted":
      return `${statusGlyph(event.result.status)} ${event.result.nodeId} · ${event.result.status}${event.result.error ? ` — ${event.result.error}` : ""}`;
    case "pipelineCompleted":
      return `✓ completed (${String(event.results.length)} nodes)`;
    case "error":
      return `✗ error: ${event.message}`;
  }
}

export function statusGlyph(status: string): string {
  if (status === "ok") {
    return "✓";
  }
  if (status === "error") {
    return "✗";
  }
  if (status === "skipped") {
    return "↷";
  }
  return "•";
}
