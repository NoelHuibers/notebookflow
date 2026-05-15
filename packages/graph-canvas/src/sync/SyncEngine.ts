/**
 * SyncEngine — keeps the derived graph in sync with the source-of-truth notebooks.
 *
 * Direction of flow:
 *   - cell→graph: notebook saved → reparse markers → diff against current
 *     graph → emit GraphModel updates.
 *   - graph→cell: user renames a node or draws a wire on the canvas → engine
 *     computes the cell-source patch (insert, update, or delete `# @node:`
 *     marker line) and applies it via the platform's notebook API.
 *
 * Conflict policy: the cell editor always wins on a direct cell edit. If a
 * graph edit and a cell edit race, the most recent timestamp wins. Platform
 * adapters call `markCellEdited(path, idx, t)` whenever the user types in a
 * cell so the engine can apply this policy when pushing graph edits.
 */

import type { GraphModel, NodeModel, NodeTag } from "../types";
import type { NotebookCell, ParseResult } from "./MarkerParser";
import { MarkerParser } from "./MarkerParser";

export type SyncDirection = "cell-to-graph" | "graph-to-cell";

export type ConflictResolution = "cell-wins" | "graph-wins" | "timestamp";

export interface SyncEvent {
  direction: SyncDirection;
  notebookPath: string;
  /** Monotonic timestamp used for tie-breaking races. */
  timestamp: number;
}

/** Patch describing a write back to the notebook (consumed by the platform adapter). */
export interface CellPatch {
  notebookPath: string;
  cellIndex: number;
  /** New source for the cell, or null to delete the cell entirely. */
  newSource: string | null;
}

export interface SyncEngineOptions {
  conflictResolution?: ConflictResolution;
  /** Called when the engine wants the platform adapter to mutate a cell. */
  onCellPatch: (patch: CellPatch) => Promise<void>;
  /** Called when the engine has computed an updated graph model. */
  onGraphUpdate: (graph: GraphModel) => void;
}

interface MarkerBody {
  name: string;
  tag: NodeTag;
  inputs: string[];
  outputs: string[];
}

const NAME_RE = /^[A-Za-z0-9 _-]+$/;

export class SyncEngine {
  private graph: GraphModel;
  private readonly lastCellEdit: Map<string, number>;
  private readonly sourceCache: Map<string, string>;
  private readonly opts: SyncEngineOptions;
  private readonly conflictResolution: ConflictResolution;

  constructor(opts: SyncEngineOptions) {
    this.opts = opts;
    this.conflictResolution = opts.conflictResolution ?? "timestamp";
    this.graph = { nodes: {}, groups: {}, wires: {} };
    this.lastCellEdit = new Map();
    this.sourceCache = new Map();
  }

  /** Cell→graph: invoked when a notebook file changes on disk or in the editor. */
  async ingestNotebook(
    notebookPath: string,
    cells: NotebookCell[],
    _timestamp: number,
  ): Promise<void> {
    const parseResult: ParseResult = MarkerParser.parseNotebook(notebookPath, cells);
    const groupId = notebookPath;

    this.upsertGroup(groupId, notebookPath);
    this.dropNodesInGroup(groupId);
    this.dropWiresTargetingGroup(groupId);
    this.refreshSourceCache(notebookPath, cells);

    const groupNodeIds: string[] = [];
    for (const marker of parseResult.markers) {
      const nodeId = makeNodeId(groupId, marker.cellIndex);
      const node: NodeModel = {
        id: nodeId,
        name: marker.name,
        tag: marker.tag,
        inputs: [...marker.inputs],
        outputs: [...marker.outputs],
        cellIndices: [marker.cellIndex],
        groupId,
      };
      this.graph.nodes[nodeId] = node;
      groupNodeIds.push(nodeId);
    }
    const group = this.graph.groups[groupId];
    if (group !== undefined) {
      group.nodeIds = groupNodeIds;
    }

    this.rebuildWiresForGroup(groupId);
    this.clearLastCellEditsFor(notebookPath);

    this.opts.onGraphUpdate(this.getGraph());
  }

  /** Records that a cell was directly edited by the user at the given timestamp. */
  markCellEdited(notebookPath: string, cellIndex: number, timestamp: number): void {
    const key = cellKey(notebookPath, cellIndex);
    const existing = this.lastCellEdit.get(key);
    if (existing === undefined || timestamp > existing) {
      this.lastCellEdit.set(key, timestamp);
    }
  }

  /** Graph→cell: rename a node and push the new marker line into its cell. */
  async renameNode(nodeId: string, nextName: string, timestamp: number): Promise<void> {
    const node = this.graph.nodes[nodeId];
    if (node === undefined) {
      throw new Error(`SyncEngine.renameNode: node ${JSON.stringify(nodeId)} not found`);
    }
    if (!NAME_RE.test(nextName)) {
      throw new Error(`SyncEngine.renameNode: invalid name ${JSON.stringify(nextName)}`);
    }

    const oldName = node.name;
    if (oldName === nextName) {
      return;
    }

    const notebookPath = this.notebookPathOf(node);
    const cellIndex = node.cellIndices[0];
    if (cellIndex === undefined) {
      throw new Error(`SyncEngine.renameNode: node ${nodeId} has no cell index`);
    }

    let didChange = false;

    const ownPatched = await this.applyMarkerPatch(
      notebookPath,
      cellIndex,
      { name: nextName, tag: node.tag, inputs: node.inputs, outputs: node.outputs },
      timestamp,
    );
    if (ownPatched) {
      node.name = nextName;
      didChange = true;
    }

    for (const other of Object.values(this.graph.nodes)) {
      if (other.groupId !== node.groupId || other.id === nodeId) {
        continue;
      }
      const newInputs = other.inputs.map((ref) => rewriteInputRef(ref, oldName, nextName));
      if (arraysEqual(newInputs, other.inputs)) {
        continue;
      }
      const otherCellIndex = other.cellIndices[0];
      if (otherCellIndex === undefined) {
        continue;
      }
      const patched = await this.applyMarkerPatch(
        notebookPath,
        otherCellIndex,
        { name: other.name, tag: other.tag, inputs: newInputs, outputs: other.outputs },
        timestamp,
      );
      if (patched) {
        other.inputs = newInputs;
        this.rewriteWiresInto(other.id, oldName, nextName);
        didChange = true;
      }
    }

    if (didChange) {
      this.opts.onGraphUpdate(this.getGraph());
    }
  }

  /** Graph→cell: persist a newly drawn wire by appending an in= ref to the target's marker. */
  async createWire(
    sourceNodeId: string,
    sourcePort: string,
    targetNodeId: string,
    _targetPort: string,
    timestamp: number,
  ): Promise<void> {
    const source = this.graph.nodes[sourceNodeId];
    const target = this.graph.nodes[targetNodeId];
    if (source === undefined) {
      throw new Error(`SyncEngine.createWire: source node ${sourceNodeId} not found`);
    }
    if (target === undefined) {
      throw new Error(`SyncEngine.createWire: target node ${targetNodeId} not found`);
    }

    const refStr = `${source.name}.${sourcePort}`;
    if (target.inputs.includes(refStr)) {
      return;
    }

    const notebookPath = this.notebookPathOf(target);
    const cellIndex = target.cellIndices[0];
    if (cellIndex === undefined) {
      throw new Error(`SyncEngine.createWire: target node ${targetNodeId} has no cell index`);
    }

    const newInputs = [...target.inputs, refStr];
    const applied = await this.applyMarkerPatch(
      notebookPath,
      cellIndex,
      { name: target.name, tag: target.tag, inputs: newInputs, outputs: target.outputs },
      timestamp,
    );
    if (!applied) {
      return;
    }

    target.inputs = newInputs;
    const wireId = makeWireId(sourceNodeId, sourcePort, targetNodeId, refStr);
    this.graph.wires[wireId] = {
      id: wireId,
      sourceNodeId,
      sourcePort,
      targetNodeId,
      targetPort: refStr,
    };

    this.opts.onGraphUpdate(this.getGraph());
  }

  /** Snapshot of the current derived graph. */
  getGraph(): GraphModel {
    return structuredClone(this.graph);
  }

  private upsertGroup(groupId: string, notebookPath: string): void {
    const existing = this.graph.groups[groupId];
    if (existing === undefined) {
      this.graph.groups[groupId] = {
        id: groupId,
        notebookPath,
        name: basenameOf(notebookPath),
        nodeIds: [],
        collapsed: false,
      };
    }
  }

  private dropNodesInGroup(groupId: string): void {
    const group = this.graph.groups[groupId];
    if (group === undefined) {
      return;
    }
    for (const nodeId of group.nodeIds) {
      Reflect.deleteProperty(this.graph.nodes, nodeId);
    }
    group.nodeIds = [];
  }

  private dropWiresTargetingGroup(groupId: string): void {
    const prefix = `${groupId}::`;
    for (const wireId of Object.keys(this.graph.wires)) {
      const wire = this.graph.wires[wireId];
      if (wire === undefined) {
        continue;
      }
      if (wire.targetNodeId.startsWith(prefix)) {
        Reflect.deleteProperty(this.graph.wires, wireId);
      }
    }
  }

  private refreshSourceCache(notebookPath: string, cells: NotebookCell[]): void {
    for (const key of [...this.sourceCache.keys()]) {
      if (key.startsWith(`${notebookPath}::`)) {
        this.sourceCache.delete(key);
      }
    }
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell?.cellType !== "code") {
        continue;
      }
      this.sourceCache.set(cellKey(notebookPath, i), cell.source);
    }
  }

  private rebuildWiresForGroup(groupId: string): void {
    const group = this.graph.groups[groupId];
    if (group === undefined) {
      return;
    }
    const nameIndex = this.buildNameIndex();
    for (const nodeId of group.nodeIds) {
      const target = this.graph.nodes[nodeId];
      if (target === undefined) {
        continue;
      }
      for (const ref of target.inputs) {
        const parsed = splitRef(ref);
        if (parsed === null) {
          continue;
        }
        const source = nameIndex.get(parsed.nodeName);
        if (source === undefined) {
          continue;
        }
        const wireId = makeWireId(source.id, parsed.portName, target.id, ref);
        this.graph.wires[wireId] = {
          id: wireId,
          sourceNodeId: source.id,
          sourcePort: parsed.portName,
          targetNodeId: target.id,
          targetPort: ref,
        };
      }
    }
  }

  private buildNameIndex(): Map<string, NodeModel> {
    const index = new Map<string, NodeModel>();
    for (const node of Object.values(this.graph.nodes)) {
      index.set(node.name, node);
    }
    return index;
  }

  private clearLastCellEditsFor(notebookPath: string): void {
    const prefix = `${notebookPath}::`;
    for (const key of [...this.lastCellEdit.keys()]) {
      if (key.startsWith(prefix)) {
        this.lastCellEdit.delete(key);
      }
    }
  }

  private notebookPathOf(node: NodeModel): string {
    const group = this.graph.groups[node.groupId];
    return group?.notebookPath ?? node.groupId;
  }

  private async applyMarkerPatch(
    notebookPath: string,
    cellIndex: number,
    body: MarkerBody,
    timestamp: number,
  ): Promise<boolean> {
    if (this.shouldDeferToCell(notebookPath, cellIndex, timestamp)) {
      return false;
    }
    const key = cellKey(notebookPath, cellIndex);
    const oldSource = this.sourceCache.get(key) ?? "";
    const newMarkerLine = MarkerParser.formatMarker(body);
    const newSource = spliceMarkerLine(oldSource, newMarkerLine);
    this.sourceCache.set(key, newSource);
    await this.opts.onCellPatch({ notebookPath, cellIndex, newSource });
    return true;
  }

  private shouldDeferToCell(notebookPath: string, cellIndex: number, timestamp: number): boolean {
    switch (this.conflictResolution) {
      case "graph-wins":
        return false;
      case "cell-wins": {
        const editedAt = this.lastCellEdit.get(cellKey(notebookPath, cellIndex));
        return editedAt !== undefined;
      }
      case "timestamp": {
        const editedAt = this.lastCellEdit.get(cellKey(notebookPath, cellIndex));
        return editedAt !== undefined && editedAt > timestamp;
      }
    }
  }

  private rewriteWiresInto(targetNodeId: string, oldName: string, newName: string): void {
    const prefix = `${oldName}.`;
    for (const wireId of Object.keys(this.graph.wires)) {
      const wire = this.graph.wires[wireId];
      if (wire === undefined) {
        continue;
      }
      if (wire.targetNodeId !== targetNodeId || !wire.targetPort.startsWith(prefix)) {
        continue;
      }
      const newPort = `${newName}.${wire.targetPort.slice(prefix.length)}`;
      const newId = makeWireId(wire.sourceNodeId, wire.sourcePort, wire.targetNodeId, newPort);
      Reflect.deleteProperty(this.graph.wires, wireId);
      this.graph.wires[newId] = { ...wire, id: newId, targetPort: newPort };
    }
  }
}

function cellKey(notebookPath: string, cellIndex: number): string {
  return `${notebookPath}::${String(cellIndex)}`;
}

function makeNodeId(groupId: string, cellIndex: number): string {
  return `${groupId}::${String(cellIndex)}`;
}

function makeWireId(srcId: string, srcPort: string, tgtId: string, tgtPort: string): string {
  return `${srcId}|${srcPort}->${tgtId}|${tgtPort}`;
}

function basenameOf(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

function splitRef(ref: string): { nodeName: string; portName: string } | null {
  const dotIdx = ref.lastIndexOf(".");
  if (dotIdx === -1) {
    return null;
  }
  return { nodeName: ref.slice(0, dotIdx), portName: ref.slice(dotIdx + 1) };
}

function rewriteInputRef(ref: string, oldName: string, newName: string): string {
  const parsed = splitRef(ref);
  if (parsed === null) {
    return ref;
  }
  return parsed.nodeName === oldName ? `${newName}.${parsed.portName}` : ref;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function spliceMarkerLine(source: string, newMarkerLine: string): string {
  if (source === "") {
    return newMarkerLine;
  }
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && line.trim() !== "") {
      lines[i] = newMarkerLine;
      return lines.join("\n");
    }
  }
  return `${newMarkerLine}\n${source}`;
}
