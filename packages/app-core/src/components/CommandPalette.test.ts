import { describe, expect, it } from "vitest";

import {
  buildCommands,
  type CommandDescriptor,
  defaultCommandPaletteLabels,
  filterCommands,
  firstSelectableIndex,
  nextSelectableIndex,
} from "./CommandPalette";

const commands: CommandDescriptor[] = buildCommands(defaultCommandPaletteLabels);

describe("buildCommands", () => {
  it("lists the four AI commands, all enabled", () => {
    expect(commands.map((command) => command.id)).toEqual([
      "ask",
      "createNode",
      "compose",
      "explain",
    ]);
    expect(commands.filter((command) => command.disabled)).toEqual([]);
  });
});

describe("filterCommands", () => {
  it("returns the full list for an empty / whitespace query", () => {
    expect(filterCommands(commands, "")).toHaveLength(commands.length);
    expect(filterCommands(commands, "   ")).toHaveLength(commands.length);
  });

  it("matches on the command title, case-insensitively", () => {
    const result = filterCommands(commands, "COMPOSE");
    expect(result.map((command) => command.id)).toEqual(["compose"]);
  });

  it("matches on the command description", () => {
    const result = filterCommands(commands, "pandas");
    expect(result.map((command) => command.id)).toEqual(["ask"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterCommands(commands, "zzz-nothing")).toEqual([]);
  });
});

describe("nextSelectableIndex", () => {
  it("steps to the next enabled row", () => {
    // ask(0) -> createNode(1)
    expect(nextSelectableIndex(commands, 0, 1)).toBe(1);
  });

  it("skips a disabled row when stepping down", () => {
    const withDisabled: CommandDescriptor[] = commands.map((command) =>
      command.id === "createNode" ? { ...command, disabled: true } : command,
    );
    // ask(0) -> createNode(1, disabled) -> compose(2)
    expect(nextSelectableIndex(withDisabled, 0, 1)).toBe(2);
  });

  it("wraps around the ends", () => {
    // explain(3) -> wrap to ask(0)
    expect(nextSelectableIndex(commands, 3, 1)).toBe(0);
    // ask(0) -> wrap up to explain(3)
    expect(nextSelectableIndex(commands, 0, -1)).toBe(3);
  });

  it("returns the current index when nothing is selectable", () => {
    const allDisabled: CommandDescriptor[] = commands.map((command) => ({
      ...command,
      disabled: true,
    }));
    expect(nextSelectableIndex(allDisabled, 2, 1)).toBe(2);
    expect(nextSelectableIndex([], 0, 1)).toBe(0);
  });
});

describe("firstSelectableIndex", () => {
  it("returns the first enabled row", () => {
    expect(firstSelectableIndex(commands)).toBe(0);
  });

  it("skips a leading disabled row", () => {
    const leadingDisabled: CommandDescriptor[] = [
      { id: "createNode", title: "a", description: "", disabled: true },
      { id: "ask", title: "b", description: "", disabled: false },
      { id: "compose", title: "c", description: "", disabled: false },
    ];
    expect(firstSelectableIndex(leadingDisabled)).toBe(1);
  });

  it("falls back to 0 when the list is empty or all-disabled", () => {
    expect(firstSelectableIndex([])).toBe(0);
    expect(firstSelectableIndex(commands.map((command) => ({ ...command, disabled: true })))).toBe(
      0,
    );
  });
});
