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

  it("renders inlet and outlet column headers with row-aligned handles", () => {
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
        />,
      );
    });

    const dropHandle = container.querySelector(`[data-handle-id="${INLET_DROP_HANDLE_ID}"]`);
    expect(dropHandle?.getAttribute("data-handle-type")).toBe("target");
  });
});
