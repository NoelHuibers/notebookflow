import { describe, expect, it } from "vitest";

import { NODE_DRAG_MIME } from "./nodeDragMime";
import { isPaletteDrag, readPaletteDragManifestId, setPaletteDragData } from "./paletteDragData";

function dataTransfer(types: string[], data: Record<string, string> = {}): DataTransfer {
  return {
    types,
    effectAllowed: "unset",
    setData(type: string, value: string): void {
      data[type] = value;
    },
    getData(type: string): string {
      return data[type] ?? "";
    },
  } as unknown as DataTransfer;
}

describe("paletteDragData", () => {
  it("sets custom and fallback payloads", () => {
    const store: Record<string, string> = {};
    const transfer = dataTransfer([], store);
    setPaletteDragData(transfer, "notebookflow.parse_csv");
    expect(store[NODE_DRAG_MIME]).toBe("notebookflow.parse_csv");
    expect(store["text/plain"]).toBe("notebookflow-manifest:notebookflow.parse_csv");
  });

  it("detects palette drags via fallback mime", () => {
    expect(isPaletteDrag(dataTransfer(["text/plain"]))).toBe(true);
    expect(isPaletteDrag(dataTransfer([NODE_DRAG_MIME]))).toBe(true);
    expect(isPaletteDrag(dataTransfer(["Files"]))).toBe(false);
  });

  it("reads manifest id from fallback payload", () => {
    const transfer = dataTransfer(["text/plain"], {
      "text/plain": "notebookflow-manifest:notebookflow.parse_csv",
    });
    expect(readPaletteDragManifestId(transfer)).toBe("notebookflow.parse_csv");
  });
});
