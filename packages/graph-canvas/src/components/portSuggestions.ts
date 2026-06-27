/**
 * Autocomplete pools for the port editor on canvas nodes.
 */

import { parseRef } from "../sync/MarkerParser";
import type { GraphModel, NodeModel } from "../types";

/** Valid output port name per the marker grammar (lowercase identifier). */
const PORT_RE = /^[a-z][a-z0-9_]*$/;

function addPortName(names: Set<string>, port: string): void {
  if (PORT_RE.test(port)) {
    names.add(port);
  }
}

/**
 * Port names a node exposes or forwards: declared outputs, passthrough names
 * from declared inputs, and variables found in the node's code.
 */
export function collectPortNames(
  node: NodeModel,
  variablesByNode: Record<string, string[]>,
): string[] {
  const names = new Set<string>();
  for (const output of node.outputs) {
    addPortName(names, output);
  }
  for (const ref of node.inputs) {
    const parsed = parseRef(ref);
    if (parsed !== null) {
      addPortName(names, parsed.portName);
    }
  }
  for (const name of variablesByNode[node.id] ?? []) {
    addPortName(names, name);
  }
  return [...names];
}

/**
 * Output port suggestions: declared outputs, passthrough names from declared
 * inputs, and variables found in the node's code.
 */
export function collectOutputSuggestions(
  node: NodeModel,
  variablesByNode: Record<string, string[]>,
): string[] {
  return collectPortNames(node, variablesByNode).sort();
}

/**
 * Upstream refs a node can consume for input autocomplete. Every other node's
 * declared outputs become `Node.port` refs (plus passthrough/code ports).
 * Cross-notebook refs are alias-qualified.
 */
export function collectInputRefs(
  graph: GraphModel,
  variablesByNode: Record<string, string[]>,
  selfId: string,
): string[] {
  const self = graph.nodes[selfId];
  const selfGroupId = self?.groupId;
  const refs = new Set<string>();
  for (const node of Object.values(graph.nodes)) {
    if (node.id === selfId) {
      continue;
    }
    const alias = node.groupId === selfGroupId ? "" : (graph.groups[node.groupId]?.alias ?? "");
    const prefix = alias === "" ? "" : `${alias}:`;
    for (const port of collectPortNames(node, variablesByNode)) {
      refs.add(`${prefix}${node.name}.${port}`);
    }
  }
  return [...refs].sort();
}
