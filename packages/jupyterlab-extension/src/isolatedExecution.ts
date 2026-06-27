/**
 * Wrap pipeline cell source so each kernel execution runs in a fresh namespace
 * fed only by declared inputs from an internal bus — mirroring the engine
 * executor's per-node isolation.
 */

import { parseRef } from "@notebookflow/graph-canvas/sync";

export const NOTEBOOKFLOW_BUS = "__notebookflow_bus__";

export interface IsolatedPipelineNode {
  id: string;
  name: string;
  alias?: string;
  inputs: string[];
  outputs: string[];
  source: string;
}

export interface InputBinding {
  localPort: string;
  sourceNodeId: string;
  sourcePort: string;
}

export function busKey(nodeId: string, port: string): string {
  return `${nodeId}\0${port}`;
}

function utf8ToBase64(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToUtf8(encoded: string): string {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function buildIdIndex(nodes: IsolatedPipelineNode[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const node of nodes) {
    index.set(`${node.alias ?? ""}\0${node.name}`, node.id);
  }
  return index;
}

export function resolveInputBindings(
  node: IsolatedPipelineNode,
  idIndex: Map<string, string>,
): InputBinding[] {
  const bindings: InputBinding[] = [];
  for (const ref of node.inputs) {
    const parsed = parseRef(ref);
    if (parsed === null) {
      continue;
    }
    const refAlias = parsed.alias ?? node.alias ?? "";
    const sourceNodeId = idIndex.get(`${refAlias}\0${parsed.nodeName}`);
    if (sourceNodeId === undefined) {
      continue;
    }
    bindings.push({
      localPort: parsed.portName,
      sourceNodeId,
      sourcePort: parsed.portName,
    });
  }
  return bindings;
}

/** Recover the original cell source from a wrapped execution payload (tests). */
export function extractCellSourceFromWrapper(code: string): string | null {
  const marker = '__nf_b64.b64decode("';
  const start = code.indexOf(marker);
  if (start === -1) {
    return null;
  }
  const encodedStart = start + marker.length;
  const encodedEnd = code.indexOf('").decode("utf-8")', encodedStart);
  if (encodedEnd === -1) {
    return null;
  }
  const encoded = code.slice(encodedStart, encodedEnd);
  return base64ToUtf8(encoded);
}

export function wrapIsolatedCellCode(
  nodeId: string,
  source: string,
  inputBindings: InputBinding[],
  outputPorts: string[],
): string {
  const encoded = utf8ToBase64(source);
  const inputLines = inputBindings.map(
    (binding) =>
      `__nf_ns[${JSON.stringify(binding.localPort)}] = __nf_bus[${JSON.stringify(busKey(binding.sourceNodeId, binding.sourcePort))}]`,
  );
  const outputLines = outputPorts.map(
    (port) =>
      `if ${JSON.stringify(port)} in __nf_ns:\n    __nf_bus[${JSON.stringify(busKey(nodeId, port))}] = __nf_ns[${JSON.stringify(port)}]`,
  );

  return `# __notebookflow_isolated__
import base64 as __nf_b64
import builtins as __nf_builtins
if ${JSON.stringify(NOTEBOOKFLOW_BUS)} not in globals():
    globals()[${JSON.stringify(NOTEBOOKFLOW_BUS)}] = {}
__nf_bus = globals()[${JSON.stringify(NOTEBOOKFLOW_BUS)}]
__nf_ns = {"__builtins__": __nf_builtins}
try:
    from IPython.display import display as __nf_display
except ImportError:
    def __nf_display(*_args, **_kwargs):
        pass
__nf_ns["display"] = __nf_display
${inputLines.join("\n")}
__nf_src = __nf_b64.b64decode(${JSON.stringify(encoded)}).decode("utf-8")
exec(compile(__nf_src, ${JSON.stringify(nodeId)}, "exec"), __nf_ns)
${outputLines.join("\n")}
`.trim();
}
