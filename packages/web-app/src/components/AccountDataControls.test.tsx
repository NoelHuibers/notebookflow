// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, type Locale } from "@/lib/i18n";
import { AccountDataControls } from "./AccountDataControls";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function renderControls(
  locale: Locale,
  onDeleteAccount = vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
): void {
  act(() => {
    root.render(
      <I18nProvider locale={locale}>
        <AccountDataControls
          email="ada@example.com"
          onExportData={vi.fn<() => Promise<void>>().mockResolvedValue(undefined)}
          onDeleteAccount={onDeleteAccount}
        />
      </I18nProvider>,
    );
  });
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${name}`);
  return button;
}

describe("AccountDataControls", () => {
  it("renders the complete data controls in English and German", () => {
    renderControls("en");
    expect(container.textContent).toContain("Export my data");
    expect(container.textContent).toContain("Delete account");

    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    renderControls("de");
    expect(container.textContent).toContain("Meine Daten exportieren");
    expect(container.textContent).toContain("Konto löschen");
  });

  it("requires the signed-in email before permanent deletion", async () => {
    const onDeleteAccount = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    renderControls("en", onDeleteAccount);

    act(() => {
      buttonNamed("Delete account").click();
    });
    const confirm = buttonNamed("Delete permanently");
    expect(confirm.disabled).toBe(true);

    const input = container.querySelector('input[type="email"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("Missing confirmation input");
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "ADA@example.com");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(confirm.disabled).toBe(false);

    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });
    expect(onDeleteAccount).toHaveBeenCalledOnce();
  });
});
