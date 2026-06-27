import { NODE_DRAG_MIME } from "@notebookflow/graph-canvas";
import { describe, expect, it } from "vitest";

import { isNotebookFileDrag } from "./FileDropZone";

function dragEvent(types: string[]): Pick<React.DragEvent, "dataTransfer"> {
  return {
    dataTransfer: {
      types,
    } as unknown as DataTransfer,
  };
}

describe("isNotebookFileDrag", () => {
  it("accepts OS file drags", () => {
    expect(isNotebookFileDrag(dragEvent(["Files"]))).toBe(true);
  });

  it("rejects palette manifest drags", () => {
    expect(isNotebookFileDrag(dragEvent([NODE_DRAG_MIME]))).toBe(false);
  });

  it("rejects drags with no dataTransfer", () => {
    expect(isNotebookFileDrag({ dataTransfer: null as unknown as DataTransfer })).toBe(false);
  });
});
