import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { Position } from "reactflow";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("reactflow", async () => {
  const actual = await vi.importActual<typeof import("reactflow")>("reactflow");
  return {
    ...actual,
    BaseEdge: ({
      id,
      path,
      style,
      markerEnd,
    }: {
      id: string;
      path: string;
      style?: {
        stroke?: string;
        strokeWidth?: number;
        strokeDasharray?: string;
      };
      markerEnd?: string;
    }) => (
      <path
        data-edge-id={id}
        data-path={path}
        data-stroke={style?.stroke}
        data-stroke-width={String(style?.strokeWidth ?? "")}
        data-stroke-dash={style?.strokeDasharray}
        data-marker-end={markerEnd}
      />
    ),
  };
});

import { Wire } from "./Wire";

interface Mount {
  container: HTMLDivElement;
  root: Root;
}

const mounts: Mount[] = [];

function mount(element: React.ReactElement): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounts.push({ container, root });
  act(() => {
    root.render(element);
  });
  return container;
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(() => {
  while (mounts.length > 0) {
    const m = mounts.pop();
    if (m === undefined) {
      continue;
    }
    act(() => {
      m.root.unmount();
    });
    m.container.remove();
  }
  vi.restoreAllMocks();
});

const baseEdgeProps = {
  id: "wire-1",
  source: "n1",
  target: "n2",
  sourceX: 0,
  sourceY: 0,
  targetX: 100,
  targetY: 100,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  selected: false,
};

describe("Wire", () => {
  it("renders a solid edge for intra-notebook connections", () => {
    const container = mount(<Wire {...baseEdgeProps} data={{ crossNotebook: false }} />);
    const path = container.querySelector("path");
    expect(path?.getAttribute("data-stroke")).toBe("#1f2937");
    expect(path?.getAttribute("data-stroke-dash")).toBeNull();
  });

  it("renders a dashed purple edge for cross-notebook connections", () => {
    const container = mount(<Wire {...baseEdgeProps} data={{ crossNotebook: true }} />);
    const path = container.querySelector("path");
    expect(path?.getAttribute("data-stroke")).toBe("#7c3aed");
    expect(path?.getAttribute("data-stroke-dash")).toBe("6 4");
  });

  it("falls back to intra-notebook styling when data is missing", () => {
    const container = mount(<Wire {...baseEdgeProps} />);
    const path = container.querySelector("path");
    expect(path?.getAttribute("data-stroke")).toBe("#1f2937");
  });

  it("forwards the markerEnd when provided", () => {
    const container = mount(
      <Wire {...baseEdgeProps} data={{ crossNotebook: false }} markerEnd="url(#arrow)" />,
    );
    expect(container.querySelector("path")?.getAttribute("data-marker-end")).toBe("url(#arrow)");
  });
});
