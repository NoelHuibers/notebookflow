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
          inputs={["df<-Load CSV.df", "x<-Other.x"]}
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

    expect(container.textContent).toContain("df");
    expect(container.textContent).toContain("x");
    expect(container.textContent).not.toContain("Load CSV.df");
    expect(container.querySelector('[title="df<-Load CSV.df"]')).not.toBeNull();
    expect(container.querySelector('[title="x<-Other.x"]')).not.toBeNull();
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

  it("mirrors long stacked variable labels in the handle rail for alignment", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    document.body.appendChild(container);
    mounts.push({ container, root });

    act(() => {
      root.render(
        <>
          <InletOutletGrid
            tag="transform"
            inputs={["very_long_input_variable_name<-Load CSV.extremely_long_source_name"]}
            outputs={[]}
            showInlets
            showOutlets={false}
            editable={false}
            inputSuggestions={[]}
            outputSuggestions={[]}
            placement="stacked"
            edge="top"
          />
          <InletOutletGrid
            tag="transform"
            inputs={[]}
            outputs={["very_long_output_variable_name"]}
            showInlets={false}
            showOutlets
            editable={false}
            inputSuggestions={[]}
            outputSuggestions={[]}
            placement="stacked"
            edge="bottom"
          />
        </>,
      );
    });

    const topKeeper = container.querySelector(
      '[data-testid="handle-rail-top"] [data-testid="stacked-port-width-keeper"]',
    );
    const bottomKeeper = container.querySelector(
      '[data-testid="handle-rail-bottom"] [data-testid="stacked-port-width-keeper"]',
    );

    expect(topKeeper?.textContent).toContain("very_long_input_variable_name");
    expect(topKeeper?.textContent).not.toContain("Load CSV");
    expect(bottomKeeper?.textContent).toContain("very_long_output_variable_name");
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
          inputs={["df<-Load CSV.df"]}
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
    expect(container.textContent).toContain("df");
    expect(container.textContent).not.toContain("Load CSV.df");
    expect(container.querySelector('[title="df<-Load CSV.df"]')).not.toBeNull();
    expect(container.textContent).toContain("clean");

    const inletHandle = container.querySelector('[data-handle-id="df<-Load CSV.df"]');
    const outletHandle = container.querySelector('[data-handle-id="clean"]');
    expect(inletHandle?.getAttribute("data-handle-type")).toBe("target");
    expect(outletHandle?.getAttribute("data-handle-type")).toBe("source");
  });

  it("shows the local name for editable input chips and keeps the full binding tooltip", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    document.body.appendChild(container);
    mounts.push({ container, root });

    act(() => {
      root.render(
        <InletOutletGrid
          tag="transform"
          inputs={["df<-Load CSV.df"]}
          outputs={[]}
          showInlets
          showOutlets={false}
          editable
          inputSuggestions={[]}
          outputSuggestions={[]}
          onInputsChange={vi.fn()}
          placement="sides"
        />,
      );
    });

    expect(container.textContent).toContain("df");
    expect(container.textContent).not.toContain("Load CSV.df");
    expect(container.querySelector('button[title="df<-Load CSV.df"]')).not.toBeNull();
  });

  it("edits only the source side of an existing input binding", () => {
    const onInputsChange = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    document.body.appendChild(container);
    mounts.push({ container, root });

    act(() => {
      root.render(
        <InletOutletGrid
          tag="transform"
          inputs={["df<-Load CSV.df"]}
          outputs={[]}
          showInlets
          showOutlets={false}
          editable
          inputSuggestions={["Load CSV.df", "Customers.cleaned"]}
          outputSuggestions={[]}
          onInputsChange={onInputsChange}
          placement="sides"
        />,
      );
    });

    const chip = container.querySelector<HTMLButtonElement>('button[title="df<-Load CSV.df"]');
    expect(chip).not.toBeNull();

    act(() => {
      chip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Input source"]');
    expect(input).not.toBeNull();
    expect(input?.value).toBe("Load CSV.df");

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "Customers.cleaned");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onInputsChange).toHaveBeenCalledWith(["df<-Customers.cleaned"]);
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

  it("centers stacked drop hint and handle when no inputs are defined", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    document.body.appendChild(container);
    mounts.push({ container, root });

    act(() => {
      root.render(
        <InletOutletGrid
          tag="transform"
          inputs={[]}
          outputs={[]}
          showInlets
          showOutlets={false}
          editable
          inputSuggestions={[]}
          outputSuggestions={[]}
          onInputsChange={vi.fn()}
          placement="stacked"
          edge="top"
        />,
      );
    });

    expect(container.textContent).toContain("wire or add");
    const rail = container.querySelector('[data-testid="handle-rail-top"]');
    expect(rail).not.toBeNull();
    expect((rail as HTMLElement).style.justifyContent).toBe("center");
    expect(container.querySelector(`[data-handle-id="${INLET_DROP_HANDLE_ID}"]`)).not.toBeNull();
  });

  it("centers stacked add output when no outputs are defined", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    document.body.appendChild(container);
    mounts.push({ container, root });

    act(() => {
      root.render(
        <InletOutletGrid
          tag="transform"
          inputs={[]}
          outputs={[]}
          showInlets={false}
          showOutlets
          editable
          inputSuggestions={[]}
          outputSuggestions={[]}
          onOutputsChange={vi.fn()}
          placement="stacked"
          edge="bottom"
        />,
      );
    });

    const labelRow = container.querySelector(
      '[data-testid="handle-rail-bottom"]',
    )?.previousElementSibling;
    expect(labelRow).not.toBeNull();
    expect((labelRow as HTMLElement).style.justifyContent).toBe("center");
  });
});
