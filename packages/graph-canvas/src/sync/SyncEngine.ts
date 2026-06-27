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

import { INLET_DROP_HANDLE_ID } from "../components/portEditorShared";
import type { GraphModel, NodeModel, NodeTag } from "../types";
import type { NotebookCell, ParseResult } from "./MarkerParser";
import { formatRef, MarkerParser, parseRef } from "./MarkerParser";

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
  operation: "replace" | "insert" | "delete";
  /** New source for the cell, or null to delete the cell entirely. */
  newSource: string | null;
  /** Cell type for inserted cells. Ignored for replace / delete patches. */
  cellType?: NotebookCell["cellType"];
  /** Metadata for inserted or replaced cells. Ignored for delete patches. */
  metadata?: Record<string, unknown>;
}

export interface CreateNodeOptions {
  name: string;
  tag: NodeTag;
  /** Initial concrete upstream refs. Usually empty until the node is wired. */
  inputs?: string[];
  /** Declared output port names copied from the selected manifest. */
  outputs?: string[];
  /** Cell body inserted below the generated `# @node:` marker line. */
  bodySource?: string;
  /** Persisted notebook metadata for this node instance, e.g. manifest id. */
  metadata?: Record<string, unknown>;
  /** When set, insert at this index instead of appending at the end. */
  insertAtCellIndex?: number;
}

export interface UpdateNodeContentsOptions {
  /** Cell body inserted below the generated `# @node:` marker line. */
  bodySource: string;
  /** Updated notebook metadata for this node instance. */
  metadata?: Record<string, unknown>;
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
const PORT_RE = /^[a-z][a-z0-9_]*$/;

export class SyncEngine {
  private graph: GraphModel;
  private readonly lastCellEdit: Map<string, number>;
  private readonly sourceCache: Map<string, string>;
  private readonly notebookCellCounts: Map<string, number>;
  private readonly opts: SyncEngineOptions;
  private readonly conflictResolution: ConflictResolution;

  constructor(opts: SyncEngineOptions) {
    this.opts = opts;
    this.conflictResolution = opts.conflictResolution ?? "timestamp";
    this.graph = { nodes: {}, groups: {}, wires: {} };
    this.lastCellEdit = new Map();
    this.sourceCache = new Map();
    this.notebookCellCounts = new Map();
  }

  /** Cell→graph: invoked when a notebook file changes on disk or in the editor. */
  async ingestNotebook(
    notebookPath: string,
    cells: NotebookCell[],
    _timestamp: number,
  ): Promise<void> {
    this.notebookCellCounts.set(notebookPath, cells.length);
    const parseResult: ParseResult = MarkerParser.parseNotebook(notebookPath, cells);
    const groupId = notebookPath;

    this.upsertGroup(groupId, notebookPath, parseResult.alias);
    this.dropNodesInGroup(groupId);
    this.refreshSourceCache(notebookPath, cells);

    const groupNodeIds: string[] = [];
    for (const marker of parseResult.markers) {
      const cell = cells[marker.cellIndex];
      const metadata = cloneMetadata(cell?.metadata);
      const nodeId = makeNodeId(groupId, marker.cellIndex);
      const node: NodeModel = {
        id: nodeId,
        name: marker.name,
        tag: marker.tag,
        inputs: [...marker.inputs],
        outputs: [...marker.outputs],
        ...(metadata === undefined ? {} : { metadata }),
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

    // Recompute every wire across the whole workspace: a notebook's edit can
    // change which cross-notebook refs resolve, so per-group rebuilding isn't
    // enough once files compose into one pipeline.
    this.recomputeAllWires();
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
    const sourceAlias = this.graph.groups[node.groupId]?.alias ?? null;

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

    // Cascade to every ref that points at the renamed node: same-notebook
    // local refs (NodeName.port) and cross-notebook qualified refs from any
    // file (sourceAlias:NodeName.port). Matched by the OLD name so it works
    // regardless of when node.name is updated above.
    for (const other of Object.values(this.graph.nodes)) {
      if (other.id === nodeId) {
        continue;
      }
      const newInputs = other.inputs.map((ref) =>
        rewriteRefForRename(ref, node.groupId, other.groupId, sourceAlias, oldName, nextName),
      );
      if (arraysEqual(newInputs, other.inputs)) {
        continue;
      }
      const otherCellIndex = other.cellIndices[0];
      if (otherCellIndex === undefined) {
        continue;
      }
      const patched = await this.applyMarkerPatch(
        this.notebookPathOf(other),
        otherCellIndex,
        { name: other.name, tag: other.tag, inputs: newInputs, outputs: other.outputs },
        timestamp,
      );
      if (patched) {
        other.inputs = newInputs;
        didChange = true;
      }
    }

    if (didChange) {
      this.recomputeAllWires();
      this.opts.onGraphUpdate(this.getGraph());
    }
  }

  /** Graph→cell: persist a newly drawn wire by appending an in= ref to the target's marker. */
  async createWire(
    sourceNodeId: string,
    sourcePort: string,
    targetNodeId: string,
    targetPort: string,
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

    // A wire to a node in another notebook is recorded as an alias-qualified
    // ref; a same-notebook wire stays a bare local ref.
    const sameGroup = source.groupId === target.groupId;
    const sourceAlias = this.graph.groups[source.groupId]?.alias;
    const refStr =
      sameGroup || sourceAlias === undefined
        ? `${source.name}.${sourcePort}`
        : `${sourceAlias}:${source.name}.${sourcePort}`;
    const routedRef = await this.routeInputRef(target, refStr, timestamp);
    if (target.inputs.includes(routedRef)) {
      return;
    }

    const newInputs =
      targetPort === INLET_DROP_HANDLE_ID || !target.inputs.includes(targetPort)
        ? [...target.inputs, routedRef]
        : target.inputs.map((existing) => (existing === targetPort ? routedRef : existing));
    if (arraysEqual(newInputs, target.inputs)) {
      return;
    }

    const notebookPath = this.notebookPathOf(target);
    const cellIndex = target.cellIndices[0];
    if (cellIndex === undefined) {
      throw new Error(`SyncEngine.createWire: target node ${targetNodeId} has no cell index`);
    }

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
    this.recomputeAllWires();
    this.opts.onGraphUpdate(this.getGraph());
  }

  /** Graph→cell: replace a node's declared input refs and rewrite its marker. */
  async setNodeInputs(nodeId: string, nextInputs: string[], timestamp: number): Promise<void> {
    const node = this.graph.nodes[nodeId];
    if (node === undefined) {
      throw new Error(`SyncEngine.setNodeInputs: node ${JSON.stringify(nodeId)} not found`);
    }
    const normalized = normalizeInputs(nextInputs);
    const routed: string[] = [];
    for (const ref of normalized) {
      routed.push(await this.routeInputRef(node, ref, timestamp));
    }
    await this.applyPorts(node, routed, node.outputs, timestamp);
  }

  /** Graph→cell: replace a node's declared output port names and rewrite its marker. */
  async setNodeOutputs(nodeId: string, nextOutputs: string[], timestamp: number): Promise<void> {
    const node = this.graph.nodes[nodeId];
    if (node === undefined) {
      throw new Error(`SyncEngine.setNodeOutputs: node ${JSON.stringify(nodeId)} not found`);
    }
    await this.applyPorts(node, node.inputs, normalizeOutputs(nextOutputs), timestamp);
  }

  /** Graph→cell: append or insert a brand-new node cell in the notebook. */
  async createNode(
    notebookPath: string,
    options: CreateNodeOptions,
    _timestamp: number,
  ): Promise<void> {
    const cellCount = this.notebookCellCounts.get(notebookPath);
    if (cellCount === undefined) {
      throw new Error(
        `SyncEngine.createNode: notebook ${JSON.stringify(notebookPath)} has not been ingested`,
      );
    }

    const insertAt = options.insertAtCellIndex ?? cellCount;
    if (insertAt < 0 || insertAt > cellCount) {
      throw new Error(
        `SyncEngine.createNode: insertAtCellIndex ${String(insertAt)} out of range for ${String(cellCount)} cells`,
      );
    }

    const name = this.uniqueNodeName(notebookPath, options.name);
    const markerBody = {
      name,
      tag: options.tag,
      inputs: normalizeInputs(options.inputs ?? []),
      outputs: normalizeOutputs(options.outputs ?? []),
    } satisfies MarkerBody;
    const newSource = composeNodeSource(markerBody, options.bodySource ?? "");

    for (let index = cellCount - 1; index >= insertAt; index -= 1) {
      const source = this.sourceCache.get(cellKey(notebookPath, index));
      if (source !== undefined) {
        this.sourceCache.set(cellKey(notebookPath, index + 1), source);
        this.sourceCache.delete(cellKey(notebookPath, index));
      }
    }
    this.sourceCache.set(cellKey(notebookPath, insertAt), newSource);
    this.notebookCellCounts.set(notebookPath, cellCount + 1);

    await this.opts.onCellPatch({
      notebookPath,
      cellIndex: insertAt,
      operation: "insert",
      cellType: "code",
      newSource,
      ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    });
  }

  /** Graph→cell: replace a node's body source and optional metadata. */
  async updateNodeContents(
    nodeId: string,
    options: UpdateNodeContentsOptions,
    timestamp: number,
  ): Promise<void> {
    const node = this.graph.nodes[nodeId];
    if (node === undefined) {
      throw new Error(`SyncEngine.updateNodeContents: node ${JSON.stringify(nodeId)} not found`);
    }

    const notebookPath = this.notebookPathOf(node);
    const cellIndex = node.cellIndices[0];
    if (cellIndex === undefined) {
      throw new Error(`SyncEngine.updateNodeContents: node ${nodeId} has no cell index`);
    }

    const newSource = composeNodeSource(
      { name: node.name, tag: node.tag, inputs: node.inputs, outputs: node.outputs },
      options.bodySource,
    );
    const metadata = cloneMetadata(options.metadata);
    const applied = await this.applySourcePatch(
      notebookPath,
      cellIndex,
      newSource,
      timestamp,
      metadata,
    );
    if (!applied) {
      return;
    }

    if (metadata === undefined) {
      Reflect.deleteProperty(node, "metadata");
    } else {
      node.metadata = metadata;
    }
    this.opts.onGraphUpdate(this.getGraph());
  }

  /** Snapshot of the current derived graph. */
  getGraph(): GraphModel {
    return structuredClone(this.graph);
  }

  private upsertGroup(groupId: string, notebookPath: string, alias: string): void {
    const existing = this.graph.groups[groupId];
    if (existing === undefined) {
      this.graph.groups[groupId] = {
        id: groupId,
        notebookPath,
        name: basenameOf(notebookPath),
        alias,
        nodeIds: [],
        collapsed: false,
      };
      return;
    }
    // A re-ingest may change the declared alias.
    existing.alias = alias;
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

  /** Map an alias to the group declaring it. First match wins on collision. */
  private groupIdForAlias(alias: string): string | null {
    for (const group of Object.values(this.graph.groups)) {
      if (group.alias === alias) {
        return group.id;
      }
    }
    return null;
  }

  /**
   * Resolve an `in=` ref to its source node + port. Local refs (no alias)
   * resolve strictly within `targetGroupId`; qualified `alias:Node.port` refs
   * resolve within the aliased group. There is no global-name fallback.
   */
  private resolveRef(
    ref: string,
    targetGroupId: string,
  ): { source: NodeModel; portName: string } | null {
    const parsed = parseRef(ref);
    if (parsed === null) {
      return null;
    }
    const groupId = parsed.alias === null ? targetGroupId : this.groupIdForAlias(parsed.alias);
    if (groupId === null) {
      return null;
    }
    const group = this.graph.groups[groupId];
    if (group === undefined) {
      return null;
    }
    for (const nodeId of group.nodeIds) {
      const node = this.graph.nodes[nodeId];
      if (node?.name === parsed.nodeName) {
        return { source: node, portName: parsed.portName };
      }
    }
    return null;
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

  private uniqueNodeName(notebookPath: string, baseName: string): string {
    if (!NAME_RE.test(baseName)) {
      throw new Error(`SyncEngine.createNode: invalid name ${JSON.stringify(baseName)}`);
    }
    const group = this.graph.groups[notebookPath];
    const used = new Set(
      (group?.nodeIds ?? [])
        .map((nodeId) => this.graph.nodes[nodeId]?.name)
        .filter((name): name is string => name !== undefined),
    );
    if (!used.has(baseName)) {
      return baseName;
    }
    let suffix = 2;
    let candidate = `${baseName} ${String(suffix)}`;
    while (used.has(candidate)) {
      suffix += 1;
      candidate = `${baseName} ${String(suffix)}`;
    }
    return candidate;
  }

  private async applyMarkerPatch(
    notebookPath: string,
    cellIndex: number,
    body: MarkerBody,
    timestamp: number,
  ): Promise<boolean> {
    const key = cellKey(notebookPath, cellIndex);
    const oldSource = this.sourceCache.get(key) ?? "";
    const newMarkerLine = MarkerParser.formatMarker(body);
    const newSource = spliceMarkerLine(oldSource, newMarkerLine);
    return this.applySourcePatch(notebookPath, cellIndex, newSource, timestamp);
  }

  private async applySourcePatch(
    notebookPath: string,
    cellIndex: number,
    newSource: string,
    timestamp: number,
    metadata?: Record<string, unknown>,
  ): Promise<boolean> {
    if (this.shouldDeferToCell(notebookPath, cellIndex, timestamp)) {
      return false;
    }
    const key = cellKey(notebookPath, cellIndex);
    this.sourceCache.set(key, newSource);
    await this.opts.onCellPatch({
      notebookPath,
      cellIndex,
      operation: "replace",
      newSource,
      ...(metadata === undefined ? {} : { metadata }),
    });
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

  private async applyPorts(
    node: NodeModel,
    nextInputs: string[],
    nextOutputs: string[],
    timestamp: number,
  ): Promise<void> {
    if (arraysEqual(nextInputs, node.inputs) && arraysEqual(nextOutputs, node.outputs)) {
      return;
    }
    const notebookPath = this.notebookPathOf(node);
    const cellIndex = node.cellIndices[0];
    if (cellIndex === undefined) {
      throw new Error(`SyncEngine.applyPorts: node ${node.id} has no cell index`);
    }
    const applied = await this.applyMarkerPatch(
      notebookPath,
      cellIndex,
      { name: node.name, tag: node.tag, inputs: nextInputs, outputs: nextOutputs },
      timestamp,
    );
    if (!applied) {
      return;
    }
    node.inputs = nextInputs;
    node.outputs = nextOutputs;
    this.recomputeAllWires();
    this.opts.onGraphUpdate(this.getGraph());
  }

  /**
   * Resolve the input ref a target should declare. When an upstream node sits
   * earlier in the same notebook and a wire path already connects them through
   * intermediate cells, wire the port through those intermediates. Otherwise
   * link the target directly to the origin.
   */
  private async routeInputRef(
    target: NodeModel,
    requestedRef: string,
    timestamp: number,
  ): Promise<string> {
    const parsed = parseRef(requestedRef);
    if (parsed === null) {
      return requestedRef;
    }
    const resolved = this.resolveRef(requestedRef, target.groupId);
    if (resolved === null) {
      return formatRef(parsed);
    }
    const { source, portName } = resolved;
    await this.ensureOutputPort(source, portName, timestamp);

    // Cross-notebook refs and targets outside the source notebook stay direct.
    if (parsed.alias !== null || source.groupId !== target.groupId) {
      return formatRef(parsed);
    }

    const ordered = this.orderedNodesInGroup(target.groupId);
    const intermediates = wiredIntermediatesBetween(this.graph, ordered, source.id, target.id);
    if (intermediates.length === 0) {
      return formatRef(parsed);
    }

    let previous = source;
    for (const mid of intermediates) {
      const upstreamRef = localPortRef(previous, portName);
      await this.ensurePassthroughNode(mid, upstreamRef, portName, timestamp);
      previous = mid;
    }
    return localPortRef(previous, portName);
  }

  /** Marker nodes in a notebook group, ordered by their first cell index. */
  private orderedNodesInGroup(groupId: string): NodeModel[] {
    const group = this.graph.groups[groupId];
    if (group === undefined) {
      return [];
    }
    return group.nodeIds
      .map((id) => this.graph.nodes[id])
      .filter((node): node is NodeModel => node !== undefined)
      .sort((a, b) => (a.cellIndices[0] ?? 0) - (b.cellIndices[0] ?? 0));
  }

  /** Append `portName` to `source`'s declared outputs when missing. */
  private async ensureOutputPort(
    source: NodeModel,
    portName: string,
    timestamp: number,
  ): Promise<boolean> {
    if (source.outputs.includes(portName)) {
      return false;
    }
    if (!PORT_RE.test(portName)) {
      return false;
    }
    const nextOutputs = normalizeOutputs([...source.outputs, portName]);
    const notebookPath = this.notebookPathOf(source);
    const cellIndex = source.cellIndices[0];
    if (cellIndex === undefined) {
      return false;
    }
    const applied = await this.applyMarkerPatch(
      notebookPath,
      cellIndex,
      { name: source.name, tag: source.tag, inputs: source.inputs, outputs: nextOutputs },
      timestamp,
    );
    if (!applied) {
      return false;
    }
    source.outputs = nextOutputs;
    return true;
  }

  /** Ensure an intermediate node consumes `upstreamRef` and re-emits `portName`. */
  private async ensurePassthroughNode(
    node: NodeModel,
    upstreamRef: string,
    portName: string,
    timestamp: number,
  ): Promise<void> {
    const normalizedUpstream = normalizeInputs([upstreamRef])[0];
    if (normalizedUpstream === undefined) {
      return;
    }
    const nextInputs = node.inputs.includes(normalizedUpstream)
      ? node.inputs
      : normalizeInputs([...node.inputs, normalizedUpstream]);
    const nextOutputs = node.outputs.includes(portName)
      ? node.outputs
      : normalizeOutputs([...node.outputs, portName]);
    if (arraysEqual(nextInputs, node.inputs) && arraysEqual(nextOutputs, node.outputs)) {
      return;
    }
    const notebookPath = this.notebookPathOf(node);
    const cellIndex = node.cellIndices[0];
    if (cellIndex === undefined) {
      return;
    }
    const applied = await this.applyMarkerPatch(
      notebookPath,
      cellIndex,
      { name: node.name, tag: node.tag, inputs: nextInputs, outputs: nextOutputs },
      timestamp,
    );
    if (!applied) {
      return;
    }
    node.inputs = nextInputs;
    node.outputs = nextOutputs;
  }

  /**
   * Rebuild every wire from the nodes' current input refs, resolving each
   * ref alias-scoped and keeping only wires to a declared output port.
   */
  private recomputeAllWires(): void {
    this.graph.wires = {};
    for (const target of Object.values(this.graph.nodes)) {
      for (const ref of target.inputs) {
        const resolved = this.resolveRef(ref, target.groupId);
        if (resolved === null || !resolved.source.outputs.includes(resolved.portName)) {
          continue;
        }
        const wireId = makeWireId(resolved.source.id, resolved.portName, target.id, ref);
        this.graph.wires[wireId] = {
          id: wireId,
          sourceNodeId: resolved.source.id,
          sourcePort: resolved.portName,
          targetNodeId: target.id,
          targetPort: ref,
        };
      }
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

/**
 * Rewrite a ref during a node rename. A ref points at the renamed node when
 * its node name matches the old name AND either it's a local ref in the same
 * notebook, or a qualified ref whose alias is the renamed node's notebook.
 * The alias prefix is preserved.
 */
function rewriteRefForRename(
  ref: string,
  renamedGroupId: string,
  refOwnerGroupId: string,
  renamedGroupAlias: string | null,
  oldName: string,
  newName: string,
): string {
  const parsed = parseRef(ref);
  if (parsed === null || parsed.nodeName !== oldName) {
    return ref;
  }
  const isLocalToRenamed = parsed.alias === null && refOwnerGroupId === renamedGroupId;
  const isQualifiedToRenamed = parsed.alias !== null && parsed.alias === renamedGroupAlias;
  if (!isLocalToRenamed && !isQualifiedToRenamed) {
    return ref;
  }
  return formatRef({ ...parsed, nodeName: newName });
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

function normalizeInputs(inputs: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of inputs) {
    const ref = raw.trim();
    // parseRef accepts both local `Node.port` and qualified `alias:Node.port`,
    // and validates the alias / name / port charsets.
    const parsed = parseRef(ref);
    if (parsed === null) {
      throw new Error(`SyncEngine: invalid input ref ${JSON.stringify(ref)}`);
    }
    const normalized = formatRef(parsed);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function normalizeOutputs(outputs: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of outputs) {
    const port = raw.trim();
    if (!PORT_RE.test(port)) {
      throw new Error(`SyncEngine: invalid output port name ${JSON.stringify(port)}`);
    }
    if (!seen.has(port)) {
      seen.add(port);
      result.push(port);
    }
  }
  return result;
}

function spliceMarkerLine(source: string, newMarkerLine: string): string {
  if (source === "") {
    return newMarkerLine;
  }
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && line.trim() !== "") {
      // Replace the marker line and drop any multi-line continuation comments
      // that follow it, so emit normalises to the canonical single-line form.
      let end = i + 1;
      while (end < lines.length && MarkerParser.isContinuationLine(lines[end] ?? "")) {
        end++;
      }
      lines.splice(i, end - i, newMarkerLine);
      return lines.join("\n");
    }
  }
  return `${newMarkerLine}\n${source}`;
}

function composeNodeSource(body: MarkerBody, bodySource: string): string {
  const marker = MarkerParser.formatMarker(body);
  return bodySource === "" ? `${marker}\n` : `${marker}\n${bodySource}`;
}

function cloneMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return metadata === undefined ? undefined : { ...metadata };
}

function localPortRef(from: { name: string }, portName: string): string {
  return `${from.name}.${portName}`;
}

/** Adjacency list from canvas wires (source node → downstream nodes). */
function buildWireAdjacency(wires: GraphModel["wires"]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const wire of Object.values(wires)) {
    const next = adj.get(wire.sourceNodeId) ?? [];
    next.push(wire.targetNodeId);
    adj.set(wire.sourceNodeId, next);
  }
  return adj;
}

function hasWirePath(adj: Map<string, string[]>, fromId: string, toId: string): boolean {
  if (fromId === toId) {
    return true;
  }
  const visited = new Set<string>();
  const queue = [fromId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      continue;
    }
    if (current === toId) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const downstream of adj.get(current) ?? []) {
      if (!visited.has(downstream)) {
        queue.push(downstream);
      }
    }
  }
  return false;
}

/**
 * Notebook-order nodes strictly between `sourceId` and `targetId` that lie on
 * an existing wire path. Empty when no path exists or nothing qualifies.
 */
function wiredIntermediatesBetween(
  graph: GraphModel,
  ordered: NodeModel[],
  sourceId: string,
  targetId: string,
): NodeModel[] {
  const adj = buildWireAdjacency(graph.wires);
  if (!hasWirePath(adj, sourceId, targetId)) {
    return [];
  }
  const srcOrder = ordered.findIndex((node) => node.id === sourceId);
  const tgtOrder = ordered.findIndex((node) => node.id === targetId);
  if (srcOrder === -1 || tgtOrder === -1 || tgtOrder <= srcOrder) {
    return [];
  }
  return ordered
    .slice(srcOrder + 1, tgtOrder)
    .filter((node) => hasWirePath(adj, sourceId, node.id) && hasWirePath(adj, node.id, targetId));
}
