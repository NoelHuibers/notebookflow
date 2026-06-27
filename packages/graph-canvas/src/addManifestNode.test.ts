import { describe, expect, it, vi } from "vitest";

import { addManifestNode } from "./addManifestNode";
import type { NodeManifestDef, NodeSynthesisResponse } from "./node-config";
import type { CellPatch } from "./sync/SyncEngine";
import { SyncEngine } from "./sync/SyncEngine";

const LLM_MANIFEST: NodeManifestDef = {
  id: "notebookflow.ai_python_transform",
  name: "AI Python Transform",
  tag: "ai",
  version: "0.1.0",
  description: "",
  inputs: [{ name: "df", type: "dataframe", required: false }],
  outputs: [{ name: "result", type: "any", required: false }],
  template: "# Instruction: {instruction}\n{primary_output} = None\n",
  generationMode: "llm",
  configFields: [
    {
      key: "instruction",
      label: "Instruction",
      kind: "textarea",
      description: "",
      placeholder: "",
      required: true,
      defaultValue: "Describe the transformation you want here.",
      options: [],
    },
  ],
};

describe("addManifestNode", () => {
  it("inserts the template before LLM synthesis completes", async () => {
    const patches: CellPatch[] = [];
    const engine = new SyncEngine({
      onGraphUpdate: () => {},
      onCellPatch: async (patch) => {
        patches.push(patch);
      },
    });
    await engine.ingestNotebook("/nb.ipynb", [], 1);

    let resolveSynth!: (value: NodeSynthesisResponse) => void;
    const synthesize = vi.fn(
      () =>
        new Promise<NodeSynthesisResponse>((resolve) => {
          resolveSynth = resolve;
        }),
    );

    void addManifestNode(engine, synthesize, {
      manifest: LLM_MANIFEST,
      notebookPath: "/nb.ipynb",
      insertAtCellIndex: 0,
    });

    await Promise.resolve();
    expect(patches).toHaveLength(1);
    expect(patches[0]?.newSource).toContain("result = None");

    await engine.ingestNotebook(
      "/nb.ipynb",
      [{ cellType: "code", source: patches[0]?.newSource ?? "" }],
      2,
    );

    resolveSynth({ source: "result = df.copy()\n", backend: "openai", warnings: [] });
    await vi.waitFor(() => {
      expect(patches.length).toBeGreaterThan(1);
    });
    expect(patches.at(-1)?.newSource).toContain("result = df.copy()");
  });
});
