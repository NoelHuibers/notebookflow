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

import { NotebookNode } from "./Node";

describe("NotebookNode", () => {
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

  it("opens inline rename from the button and forwards the trimmed name", () => {
    const onRename = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    document.body.appendChild(container);
    mounts.push({ container, root });

    act(() => {
      root.render(
        <NotebookNode
          id="node-1"
          type="notebook"
          selected={false}
          xPos={0}
          yPos={0}
          zIndex={0}
          isConnectable
          dragging={false}
          data={{
            id: "node-1",
            name: "Load CSV",
            tag: "input",
            inputs: [],
            outputs: ["df"],
            cellIndices: [0],
            groupId: "group-a",
            onRename,
          }}
        />,
      );
    });

    const button = container.querySelector('button[title="Rename node"]');
    expect(button).not.toBeNull();
    if (button === null) {
      throw new Error("Rename button not found");
    }

    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const input = container.querySelector('input[aria-label="Node name"]');
    expect(input).not.toBeNull();
    if (input === null) {
      throw new Error("Rename input not found");
    }

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (valueSetter === undefined) {
      throw new Error("Input value setter not found");
    }

    act(() => {
      valueSetter.call(input, "  Cleaner  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(onRename).toHaveBeenCalledWith("node-1", "Cleaner");
  });

  it("opens inline rename from a title double click", () => {
    const onRename = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    document.body.appendChild(container);
    mounts.push({ container, root });

    act(() => {
      root.render(
        <NotebookNode
          id="node-1"
          type="notebook"
          selected={false}
          xPos={0}
          yPos={0}
          zIndex={0}
          isConnectable
          dragging={false}
          data={{
            id: "node-1",
            name: "Load CSV",
            tag: "input",
            inputs: [],
            outputs: ["df"],
            cellIndices: [0],
            groupId: "group-a",
            onRename,
          }}
        />,
      );
    });

    const title = container.querySelector('button[title="Double-click to rename"]');
    expect(title).not.toBeNull();
    if (title === null) {
      throw new Error("Rename title not found");
    }

    act(() => {
      title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    const input = container.querySelector('input[aria-label="Node name"]');
    expect(input).not.toBeNull();
  });
});
