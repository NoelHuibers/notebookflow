import { describe, expect, it } from "vitest";
import { renderManifestTemplate } from "./manifestTemplate";
import type { NodeManifestDef } from "./node-config";

const AI_TRANSFORM: NodeManifestDef = {
  id: "notebookflow.ai_python_transform",
  name: "AI Python Transform",
  tag: "ai",
  version: "0.1.0",
  description: "",
  inputs: [{ name: "df", type: "dataframe", required: false }],
  outputs: [{ name: "result", type: "any", required: false }],
  template: "# TODO: configure API key\n# Instruction: {instruction}\n{primary_output} = None\n",
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

describe("renderManifestTemplate", () => {
  it("substitutes config and port placeholders", () => {
    expect(
      renderManifestTemplate(AI_TRANSFORM, {
        outputVars: ["result"],
        config: { instruction: "Filter rows where revenue > 0." },
      }),
    ).toBe(
      "# TODO: configure API key\n# Instruction: Filter rows where revenue > 0.\nresult = None\n",
    );
  });

  it("escapes doubled braces like Python format_map", () => {
    const manifest: NodeManifestDef = {
      ...AI_TRANSFORM,
      template: "payload = {{'role': 'user'}}\n{primary_output} = 1\n",
    };
    expect(renderManifestTemplate(manifest, { outputVars: ["out"] })).toBe(
      "payload = {'role': 'user'}\nout = 1\n",
    );
  });

  it("throws for unknown placeholders", () => {
    const manifest: NodeManifestDef = {
      ...AI_TRANSFORM,
      template: "{missing}\n",
    };
    expect(() => renderManifestTemplate(manifest)).toThrow(/unknown variable/);
  });
});
