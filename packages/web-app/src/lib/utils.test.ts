// @vitest-environment jsdom

/**
 * isTypingTarget is the guard the global keydown handler routes on: bare keys
 * (Escape, ?, m) are suppressed when the event target is a text-editing surface
 * so they don't hijack editing, and only reach the app when it returns false.
 * These cases pin the routing the ⌘K / Escape keyboard model depends on.
 */

import { afterEach, describe, expect, it } from "vitest";

import { isTypingTarget } from "./utils";

function mount<T extends HTMLElement>(el: T): T {
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isTypingTarget", () => {
  it("is true for <input> and <textarea>", () => {
    expect(isTypingTarget(mount(document.createElement("input")))).toBe(true);
    expect(isTypingTarget(mount(document.createElement("textarea")))).toBe(true);
  });

  // (contentEditable is covered by the source but not asserted here: jsdom's
  // HTMLElement.isContentEditable always reports false without layout.)

  it("is true inside a CodeMirror editor", () => {
    const editor = mount(document.createElement("div"));
    editor.className = "cm-editor";
    const inner = document.createElement("span");
    editor.appendChild(inner);
    expect(isTypingTarget(inner)).toBe(true);
  });

  it("is false for non-editing surfaces (canvas / buttons / null)", () => {
    expect(isTypingTarget(mount(document.createElement("div")))).toBe(false);
    expect(isTypingTarget(mount(document.createElement("button")))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
