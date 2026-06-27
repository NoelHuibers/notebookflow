import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("reactflow", async () => {
  const actual = await vi.importActual<typeof import("reactflow")>("reactflow");

  return {
    ...actual,
    Handle: ({ id, type }: { id?: string; type?: string }) => (
      <div data-handle-id={id} data-handle-type={type} />
    ),
  };
});

import { InletOutletGrid } from "./InletOutletGrid";
import { INLET_DROP_HANDLE_ID } from "./portEditorShared";

describe("InletOutletGrid", () => {
  const mounts: Array<{ container: HTMLDivElement; root: Root }> = [];

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });

  afterEach(() => {
    while (mounts.length > 0) {
      const mount = mounts.pop();
      if (mount === undefined) {
        continue;
      }
      act(() => {
        mount.root.unmount();
      });
      mount.container.remove();
    }
    vi.restoreAllMocks();
  });

  it("renders stacked input handles on one rail with labels below", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    document.body.appendChild(container);
    mounts.push({ container, root });

    act(() => {
      root.render(
        <InletOutletGrid
          tag="transform"
          inputs={["Load CSV.df", "Other.x"]}
          outputs={[]}
          showInlets
          showOutlets={false}
          editable={false}
          inputSuggestions={[]}
          outputSuggestions={[]}
          placement="stacked"
          edge="top"
        />,
      );
    });

    expect(container.textContent).toContain("Load CSV.df");
    expect(container.textContent).toContain("Other.x");
    const rail = container.querySelector('[data-testid="handle-rail-top"]');
    expect(rail).not.toBeNull();
    const handles = rail?.querySelectorAll('[data-handle-type="target"]');
    expect(handles?.length).toBe(2);
    const labels = container.querySelector('[data-testid="handle-rail-top"]')?.nextElementSibling;
    expect(labels?.childElementCount).toBe(2);
  });

  it("renders stacked output handles on one rail with labels above", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    document.body.appendChild(container);
    mounts.push({ container, root });

    act(() => {
      root.render(
        <InletOutletGrid
          tag="transform"
          inputs={[]}
          outputs={["clean", "summary"]}
          showInlets={false}
          showOutlets
          editable={false}
          inputSuggestions={[]}
          outputSuggestions={[]}
          placement="stacked"
          edge="bottom"
        />,
      );
    });

    expect(container.textContent).toContain("clean");
    const rail = container.querySelector('[data-testid="handle-rail-bottom"]');
    expect(rail).not.toBeNull();
    const handles = rail?.querySelectorAll('[data-handle-type="source"]');
    expect(handles?.length).toBe(2);
  });

  it("renders side input and output columns below the header row", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    document.body.appendChild(container);
    mounts.push({ container, root });

    act(() => {
      root.render(
        <InletOutletGrid
          tag="transform"
          inputs={["Load CSV.df"]}
          outputs={["clean"]}
          showInlets
          showOutlets
          editable={false}
          inputSuggestions={[]}
          outputSuggestions={[]}
          placement="sides"
        />,
      );
    });

    expect(container.textContent).toContain("Input");
    expect(container.textContent).toContain("Output");
    expect(container.textContent).toContain("Load CSV.df");
    expect(container.textContent).toContain("clean");

    const inletHandle = container.querySelector('[data-handle-id="Load CSV.df"]');
    const outletHandle = container.querySelector('[data-handle-id="clean"]');
    expect(inletHandle?.getAttribute("data-handle-type")).toBe("target");
    expect(outletHandle?.getAttribute("data-handle-type")).toBe("source");
  });

  it("exposes a drop-target inlet handle when editable", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    document.body.appendChild(container);
    mounts.push({ container, root });

    act(() => {
      root.render(
        <InletOutletGrid
          tag="transform"
          inputs={[]}
          outputs={["clean"]}
          showInlets
          showOutlets
          editable
          inputSuggestions={[]}
          outputSuggestions={[]}
          onInputsChange={vi.fn()}
          onOutputsChange={vi.fn()}
          placement="sides"
        />,
      );
    });

    const dropHandle = container.querySelector(`[data-handle-id="${INLET_DROP_HANDLE_ID}"]`);
    expect(dropHandle?.getAttribute("data-handle-type")).toBe("target");
  });
});
