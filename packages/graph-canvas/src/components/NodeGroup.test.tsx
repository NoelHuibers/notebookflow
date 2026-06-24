import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { NODE_GROUP_HEADER_HEIGHT, NodeGroup } from "./NodeGroup";

const baseGroup = {
  id: "group-a",
  notebookPath: "data/pipelines/main.ipynb",
  name: "main.ipynb",
  alias: "main",
  nodeIds: ["n1", "n2"],
  collapsed: false,
};

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

describe("NodeGroup", () => {
  it("renders the notebook name and the path", () => {
    const container = mount(
      <NodeGroup
        id="group-a"
        type="group"
        selected={false}
        xPos={0}
        yPos={0}
        zIndex={0}
        isConnectable={false}
        dragging={false}
        data={baseGroup}
      />,
    );

    expect(container.textContent).toContain("main.ipynb");
    expect(container.textContent).toContain("data/pipelines/main.ipynb");
  });

  it("calls onToggle with the group id when the chevron is clicked", () => {
    const onToggle = vi.fn();
    const container = mount(
      <NodeGroup
        id="group-a"
        type="group"
        selected={false}
        xPos={0}
        yPos={0}
        zIndex={0}
        isConnectable={false}
        dragging={false}
        data={{ ...baseGroup, onToggle }}
      />,
    );

    const button = container.querySelector('button[aria-label="Collapse notebook"]');
    expect(button).not.toBeNull();
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onToggle).toHaveBeenCalledWith("group-a");
  });

  it("renders an Expand label when the group is collapsed", () => {
    const container = mount(
      <NodeGroup
        id="group-a"
        type="group"
        selected={false}
        xPos={0}
        yPos={0}
        zIndex={0}
        isConnectable={false}
        dragging={false}
        data={{ ...baseGroup, collapsed: true }}
      />,
    );
    expect(container.querySelector('button[aria-label="Expand notebook"]')).not.toBeNull();
  });

  it("does not throw when onToggle is omitted and the chevron is clicked", () => {
    const container = mount(
      <NodeGroup
        id="group-a"
        type="group"
        selected={false}
        xPos={0}
        yPos={0}
        zIndex={0}
        isConnectable={false}
        dragging={false}
        data={baseGroup}
      />,
    );
    const button = container.querySelector("button");
    expect(() => {
      act(() => {
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }).not.toThrow();
  });

  it("exposes the shared header-height constant the canvas uses for layout", () => {
    expect(NODE_GROUP_HEADER_HEIGHT).toBeGreaterThan(0);
  });
});
