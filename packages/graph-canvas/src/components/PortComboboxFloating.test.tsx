import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { PortComboboxFloating } from "./PortComboboxFloating";

describe("PortComboboxFloating", () => {
  const mounts: Array<{ container: HTMLDivElement; root: Root; anchor: HTMLButtonElement }> = [];

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
      mount.anchor.remove();
    }
    document.querySelectorAll('[data-testid="port-combobox-floating"]').forEach((node) => {
      node.remove();
    });
    vi.restoreAllMocks();
  });

  function mountCombobox(onCancel = vi.fn()): { onCancel: ReturnType<typeof vi.fn> } {
    const container = document.createElement("div");
    const anchor = document.createElement("button");
    anchor.textContent = "port";
    document.body.appendChild(container);
    document.body.appendChild(anchor);
    anchor.getBoundingClientRect = () =>
      ({
        top: 10,
        left: 20,
        bottom: 30,
        right: 120,
        width: 100,
        height: 20,
        x: 20,
        y: 10,
        toJSON: () => ({}),
      }) as DOMRect;

    const root = createRoot(container);
    mounts.push({ container, root, anchor });

    act(() => {
      root.render(
        <PortComboboxFloating
          anchorEl={anchor}
          kind="input"
          initialValue=""
          suggestions={["Load CSV.df"]}
          onCommit={vi.fn()}
          onCancel={onCancel}
        />,
      );
    });

    return { onCancel };
  }

  it("dismisses on pointerdown outside the combobox and anchor", () => {
    const { onCancel } = mountCombobox();
    const outside = document.createElement("div");
    document.body.appendChild(outside);

    act(() => {
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    outside.remove();
  });

  it("keeps open on pointerdown inside the combobox", () => {
    const { onCancel } = mountCombobox();
    const combobox = document.querySelector('[data-testid="port-combobox-floating"]');
    expect(combobox).not.toBeNull();

    act(() => {
      combobox?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(onCancel).not.toHaveBeenCalled();
  });
});
