import { describe, expect, it } from "vitest";
import { extractSourceFilename } from "./sourceMeta";

describe("extractSourceFilename", () => {
  it("extracts the literal passed to read_csv", () => {
    expect(extractSourceFilename('df = pd.read_csv("orders.csv")')).toBe("orders.csv");
  });

  it("extracts the literal passed to open()", () => {
    expect(extractSourceFilename("with open('notes.txt') as f:\n    pass")).toBe("notes.txt");
  });

  it("returns null when no reader call is present", () => {
    expect(extractSourceFilename("x = 1 + 1")).toBeNull();
  });

  it("returns only the basename of a path literal", () => {
    expect(extractSourceFilename('pd.read_parquet("data/raw/events.parquet")')).toBe(
      "events.parquet",
    );
    expect(extractSourceFilename('pd.read_json("data\\\\dump.json")')).toBe("dump.json");
  });
});
