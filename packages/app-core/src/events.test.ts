import { describe, expect, it } from "vitest";

import { buildGenerationStatus, defaultEventLabels, renderEvent, statusGlyph } from "./events";
import type { EngineEvent, ExecutionResultMsg } from "./types";

function result(overrides: Partial<ExecutionResultMsg> = {}): ExecutionResultMsg {
  return {
    nodeId: "n1",
    status: "ok",
    error: null,
    durationMs: 12,
    outputs: [],
    ...overrides,
  };
}

describe("renderEvent (English defaults)", () => {
  it("formats executionStarted", () => {
    expect(renderEvent({ type: "executionStarted", pipelineId: "p1" })).toBe("▶ started p1");
  });

  it("formats nodeStarted", () => {
    expect(renderEvent({ type: "nodeStarted", pipelineId: "p1", nodeId: "n1" })).toBe(
      "… n1 · running",
    );
  });

  it("formats nodeCompleted without an error", () => {
    expect(renderEvent({ type: "nodeCompleted", pipelineId: "p1", result: result() })).toBe(
      "✓ n1 · ok",
    );
  });

  it("formats nodeCompleted with an error suffix", () => {
    const event = {
      type: "nodeCompleted",
      pipelineId: "p1",
      result: result({ status: "error", error: "boom" }),
    } as const;
    expect(renderEvent(event)).toBe("✗ n1 · error — boom");
  });

  it("formats pipelineCompleted with the node count", () => {
    const event: EngineEvent = {
      type: "pipelineCompleted",
      pipelineId: "p1",
      results: [result(), result({ nodeId: "n2" })],
    };
    expect(renderEvent(event)).toBe("✓ completed (2 nodes)");
  });

  it("formats error events", () => {
    expect(renderEvent({ type: "error", message: "kaput" })).toBe("✗ error: kaput");
  });

  it("honors label overrides", () => {
    const labels = { ...defaultEventLabels, eventStarted: "gestartet: {pipelineId}" };
    expect(renderEvent({ type: "executionStarted", pipelineId: "p1" }, labels)).toBe(
      "gestartet: p1",
    );
  });
});

describe("statusGlyph", () => {
  it("maps known statuses to glyphs", () => {
    expect(statusGlyph("ok")).toBe("✓");
    expect(statusGlyph("error")).toBe("✗");
    expect(statusGlyph("skipped")).toBe("↷");
    expect(statusGlyph("queued")).toBe("•");
  });
});

describe("buildGenerationStatus", () => {
  it("returns null when no generation metadata exists", () => {
    expect(buildGenerationStatus({})).toBeNull();
  });

  it("renders backend-only metadata without a timestamp", () => {
    expect(buildGenerationStatus({ lastGenerationBackend: "anthropic" })).toBe(
      "Last generated via anthropic.",
    );
  });

  it("falls back to the template backend and localizes the timestamp", () => {
    const iso = "2026-07-19T12:00:00.000Z";
    const when = new Date(iso).toLocaleString();
    expect(buildGenerationStatus({ lastGeneratedAt: iso })).toBe(
      `Last generated via template at ${when}.`,
    );
  });

  it("renders backend and timestamp together", () => {
    const iso = "2026-07-19T12:00:00.000Z";
    const when = new Date(iso).toLocaleString();
    expect(
      buildGenerationStatus({ lastGenerationBackend: "anthropic", lastGeneratedAt: iso }),
    ).toBe(`Last generated via anthropic at ${when}.`);
  });
});
