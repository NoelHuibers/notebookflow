import type { NodeManifestDef } from "./node-config";
import { defaultConfigForManifest } from "./node-config";

export interface RenderManifestTemplateParams {
  nodeName?: string;
  inputVars?: string[];
  outputVars?: string[];
  config?: Record<string, string>;
}

/** Render a manifest's cell body locally (mirrors engine Loader.render_template). */
export function renderManifestTemplate(
  manifest: NodeManifestDef,
  params: RenderManifestTemplateParams = {},
): string {
  const inputVars = params.inputVars ?? [];
  const outputVars = params.outputVars ?? manifest.outputs.map((port) => port.name);
  const config = params.config ?? defaultConfigForManifest(manifest);

  const primaryInput = inputVars[0] ?? manifest.inputs[0]?.name ?? "value";
  const primaryOutput = outputVars[0] ?? manifest.outputs[0]?.name ?? "result";

  const context: Record<string, string | number> = {
    node_name: params.nodeName ?? manifest.name,
    manifest_id: manifest.id,
    primary_input: primaryInput,
    primary_input_literal: JSON.stringify(primaryInput),
    primary_output: primaryOutput,
    primary_output_literal: JSON.stringify(primaryOutput),
    input_count: inputVars.length,
    output_count: outputVars.length,
  };

  for (const [key, value] of Object.entries(config)) {
    context[key] = value;
    context[`${key}_literal`] = JSON.stringify(value);
  }

  const rendered = formatTemplate(manifest.template, context);
  return rendered.endsWith("\n") ? rendered : `${rendered}\n`;
}

function formatTemplate(template: string, context: Record<string, string | number>): string {
  let result = "";
  let index = 0;

  while (index < template.length) {
    const char = template[index];
    if (char === "{") {
      if (template[index + 1] === "{") {
        result += "{";
        index += 2;
        continue;
      }
      const close = template.indexOf("}", index + 1);
      if (close === -1) {
        throw new Error("Unclosed template placeholder");
      }
      const key = template.slice(index + 1, close);
      if (key === "") {
        result += "{}";
        index = close + 1;
        continue;
      }
      const value = context[key];
      if (value === undefined) {
        throw new Error(`Manifest template references unknown variable ${JSON.stringify(key)}`);
      }
      result += String(value);
      index = close + 1;
      continue;
    }
    if (char === "}" && template[index + 1] === "}") {
      result += "}";
      index += 2;
      continue;
    }
    result += char;
    index += 1;
  }

  return result;
}
