/**
 * Standalone web app — fully functional NotebookFlow client.
 *
 * - Drop / pick an `.ipynb` to load cells into the editor + canvas.
 * - Edit cells inline (CodeMirror); the SyncEngine re-ingests after
 *   a 300 ms debounce so the canvas reflects marker edits live.
 * - Click Run to dispatch the current graph over WebSocket to the engine
 *   (default `ws://localhost:8765/ws`; production override via
 *   ``VITE_NOTEBOOKFLOW_ENGINE_URL``). Execution events stream in.
 * - Click Download to save the patched `.ipynb` back to disk.
 */

import type { GraphModel, NodeModel } from "@notebookflow/graph-canvas";
import { Canvas } from "@notebookflow/graph-canvas";
import type { CellPatch, NotebookCell } from "@notebookflow/graph-canvas/sync";
import { SyncEngine } from "@notebookflow/graph-canvas/sync";
import { Download, Play, RotateCcw } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CellList } from "@/components/CellList";
import { EngineStatus } from "@/components/EngineStatus";
import { FileDropZone } from "@/components/FileDropZone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { EngineEvent, PipelineDef } from "@/lib/EngineClient";
import { EngineClient } from "@/lib/EngineClient";
import type { IpynbDoc } from "@/lib/notebook";
import { downloadNotebook, parseNotebook } from "@/lib/notebook";

import twoNode from "./fixtures/two-node.ipynb.json";

const EMPTY_GRAPH: GraphModel = { nodes: {}, groups: {}, wires: {} };

interface LoadedNotebook {
  name: string;
  cells: NotebookCell[];
  doc: IpynbDoc;
}

export function App(): ReactElement {
  const [notebook, setNotebook] = useState<LoadedNotebook>(() => bootstrapFromFixture());
  const [graph, setGraph] = useState<GraphModel>(EMPTY_GRAPH);
  const [selected, setSelected] = useState<NodeModel | null>(null);
  const [patches, setPatches] = useState<CellPatch[]>([]);
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const clientRef = useRef<EngineClient>(new EngineClient());

  // Lazily construct the SyncEngine once. We re-call ingest whenever the
  // notebook's cell array changes (drop, edit-debounce, re-ingest button).
  useEffect(() => {
    const engine = new SyncEngine({
      onGraphUpdate: setGraph,
      onCellPatch: (patch: CellPatch): Promise<void> => {
        setPatches((prev) => [...prev, patch]);
        // Keep our local cell state in sync with cell patches the engine emits.
        // Patches are full-cell replacements; index into the current array.
        setNotebook((prev) => {
          if (patch.cellIndex < 0 || patch.cellIndex >= prev.cells.length) {
            return prev;
          }
          const cell = prev.cells[patch.cellIndex];
          if (cell === undefined) {
            return prev;
          }
          const nextSource = patch.newSource ?? "";
          if (cell.source === nextSource) {
            return prev;
          }
          const nextCells = prev.cells.slice();
          nextCells[patch.cellIndex] = { ...cell, source: nextSource };
          return { ...prev, cells: nextCells };
        });
        return Promise.resolve();
      },
    });
    engineRef.current = engine;
  }, []);

  // Re-ingest whenever the cell array changes.
  useEffect(() => {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    void engine.ingestNotebook(notebook.name, notebook.cells, Date.now());
  }, [notebook]);

  const handleFile = useCallback((text: string, name: string): void => {
    try {
      const parsed = parseNotebook(text);
      setNotebook({ name, cells: parsed.cells, doc: parsed.doc });
      setSelected(null);
      setPatches([]);
      setEvents([]);
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      setError(`Failed to load ${name}: ${message}`);
    }
  }, []);

  const handleCellsChange = useCallback((next: NotebookCell[]): void => {
    setNotebook((prev) => ({ ...prev, cells: next }));
  }, []);

  const handleRename = useCallback((nodeId: string, nextName: string): void => {
    void engineRef.current?.renameNode(nodeId, nextName, Date.now());
  }, []);

  const pipelineDef = useMemo<PipelineDef>(
    () => buildPipelineDef(graph, notebook.cells, notebook.name),
    [graph, notebook],
  );

  const handleRun = useCallback((): void => {
    if (isRunning) {
      return;
    }
    setEvents([]);
    setIsRunning(true);
    setError(null);
    clientRef.current
      .runPipeline({
        pipelineId: `web-${String(Date.now())}`,
        pipeline: pipelineDef,
        onEvent: (event) => {
          setEvents((prev) => [...prev, event]);
        },
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "unknown error";
        setError(`Pipeline run failed: ${message}`);
      })
      .finally(() => {
        setIsRunning(false);
      });
  }, [isRunning, pipelineDef]);

  const handleDownload = useCallback((): void => {
    downloadNotebook(notebook.cells, notebook.doc, notebook.name);
  }, [notebook]);

  const handleReingest = useCallback((): void => {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    setPatches([]);
    void engine.ingestNotebook(notebook.name, notebook.cells, Date.now());
  }, [notebook]);

  const nodeCount = Object.keys(graph.nodes).length;

  return (
    <FileDropZone onFile={handleFile}>
      <div className="flex h-screen flex-col bg-background text-foreground font-sans">
        <header className="flex items-center gap-3 border-b bg-card px-4 py-2.5">
          <span className="font-semibold tracking-tight">NotebookFlow</span>
          <Badge variant="secondary" className="font-mono">
            {notebook.name}
          </Badge>
          <Badge variant="outline" className="font-mono">
            {nodeCount} {nodeCount === 1 ? "node" : "nodes"}
          </Badge>
          <EngineStatus client={clientRef.current} />
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleReingest}>
              <RotateCcw className="mr-1.5 size-3.5" />
              Re-ingest
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="mr-1.5 size-3.5" />
              Download
            </Button>
            <Button variant="default" size="sm" onClick={handleRun} disabled={isRunning}>
              <Play className="mr-1.5 size-3.5" />
              {isRunning ? "Running…" : "Run pipeline"}
            </Button>
          </div>
        </header>

        {error !== null && (
          <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <section className="flex w-1/2 min-w-0 flex-col border-r">
            <div className="border-b px-4 py-2 text-xs text-muted-foreground">Cells</div>
            <ScrollArea className="flex-1">
              <CellList cells={notebook.cells} onCellsChange={handleCellsChange} />
            </ScrollArea>
          </section>

          <section className="flex w-1/2 min-w-0 flex-col">
            <div className="border-b px-4 py-2 text-xs text-muted-foreground">Canvas</div>
            <div className="relative flex-1 bg-background">
              <Canvas graph={graph} onNodeRename={handleRename} onNodeSelect={setSelected} />
            </div>
          </section>
        </div>

        <Separator />
        <aside className="grid grid-cols-3 divide-x border-t bg-muted/30 text-xs">
          <InspectorPanel title="Selected" count={selected === null ? 0 : 1} empty="Click a node.">
            {selected !== null && (
              <pre className="overflow-x-auto rounded-md border bg-background p-2 font-mono text-[11px]">
                {JSON.stringify(selected, null, 2)}
              </pre>
            )}
          </InspectorPanel>

          <InspectorPanel
            title="Execution events"
            count={events.length}
            empty="Click Run to dispatch this pipeline."
          >
            <ul className="flex flex-col gap-1">
              {events.map((event, idx) => (
                <li
                  key={`${event.type}-${String(idx)}`}
                  className="rounded border bg-background px-2 py-1 font-mono text-[11px]"
                >
                  {renderEvent(event)}
                </li>
              ))}
            </ul>
          </InspectorPanel>

          <InspectorPanel
            title="Cell patches"
            count={patches.length}
            empty="Rename a node in the canvas to see one."
          >
            {patches.map((patch, idx) => (
              <div
                key={`${patch.notebookPath}-${String(patch.cellIndex)}-${String(idx)}`}
                className="rounded border bg-background p-2"
              >
                <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Badge variant="secondary" className="font-mono">
                    cell {patch.cellIndex}
                  </Badge>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px]">
                  {patch.newSource ?? "(deleted)"}
                </pre>
              </div>
            ))}
          </InspectorPanel>
        </aside>
      </div>
    </FileDropZone>
  );
}

interface InspectorPanelProps {
  title: string;
  count: number;
  empty: string;
  children?: React.ReactNode;
}

function InspectorPanel({ title, count, empty, children }: InspectorPanelProps): ReactElement {
  return (
    <div className="flex max-h-48 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {title}
        <Badge variant="outline" className="font-mono text-[10px]">
          {count}
        </Badge>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2 p-3">
          {count === 0 ? (
            <p className="text-[11px] italic text-muted-foreground">{empty}</p>
          ) : (
            children
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function bootstrapFromFixture(): LoadedNotebook {
  const parsed = parseNotebook(JSON.stringify(twoNode));
  return { name: "two-node.ipynb", cells: parsed.cells, doc: parsed.doc };
}

function buildPipelineDef(
  graph: GraphModel,
  cells: NotebookCell[],
  notebookPath: string,
): PipelineDef {
  const nodes = Object.values(graph.nodes).map((node) => {
    const cellIndex = node.cellIndices[0] ?? 0;
    const source = cells[cellIndex]?.source ?? "";
    return {
      id: node.id,
      name: node.name,
      tag: node.tag,
      inputs: node.inputs,
      outputs: node.outputs,
      source: stripMarkerLine(source),
      notebookPath,
      cellIndices: node.cellIndices,
    };
  });
  const edges = Object.values(graph.wires).map((wire) => ({
    sourceNodeId: wire.sourceNodeId,
    sourcePort: wire.sourcePort,
    targetNodeId: wire.targetNodeId,
    targetPort: wire.targetPort,
  }));
  return { nodes, edges };
}

function stripMarkerLine(source: string): string {
  const newline = source.indexOf("\n");
  if (newline === -1) {
    return "";
  }
  const firstLine = source.slice(0, newline).trim();
  if (firstLine.startsWith("# @node:")) {
    return source.slice(newline + 1);
  }
  return source;
}

function renderEvent(event: EngineEvent): string {
  switch (event.type) {
    case "executionStarted":
      return `▶ started ${event.pipelineId}`;
    case "nodeCompleted":
      return `${statusGlyph(event.result.status)} ${event.result.nodeId} · ${event.result.status}${event.result.error ? ` — ${event.result.error}` : ""}`;
    case "pipelineCompleted":
      return `✓ completed (${String(event.results.length)} nodes)`;
    case "error":
      return `✗ error: ${event.message}`;
  }
}

function statusGlyph(status: string): string {
  if (status === "ok") {
    return "✓";
  }
  if (status === "error") {
    return "✗";
  }
  if (status === "skipped") {
    return "↷";
  }
  return "•";
}
