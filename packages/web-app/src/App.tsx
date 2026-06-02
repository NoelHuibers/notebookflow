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
import type {
  ReactElement,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CellList } from "@/components/CellList";
import { EngineStatus } from "@/components/EngineStatus";
import { FileDropZone } from "@/components/FileDropZone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { EngineEvent, NbOutput, NodeManifestDef, PipelineDef } from "@/lib/EngineClient";
import { EngineClient } from "@/lib/EngineClient";
import type { IpynbDoc } from "@/lib/notebook";
import { downloadNotebook, parseNotebook, toIpynbCell } from "@/lib/notebook";
import { cn } from "@/lib/utils";

import twoNode from "./fixtures/two-node.ipynb.json";

const EMPTY_GRAPH: GraphModel = { nodes: {}, groups: {}, wires: {} };
const DIVIDER_SIZE_PX = 10;
const MIN_NOTEBOOK_WIDTH_PX = 280;
const MIN_CANVAS_BODY_WIDTH_PX = 320;
const MIN_PALETTE_WIDTH_PX = 220;
const MIN_MAIN_HEIGHT_PX = 220;
const MIN_INSPECTOR_HEIGHT_PX = 140;
const DEFAULT_NOTEBOOK_RATIO = 50;
const DEFAULT_MAIN_RATIO = 72;
const DEFAULT_PALETTE_WIDTH_PX = 280;
const KEYBOARD_RESIZE_STEP = 2;
const TAG_ORDER = ["input", "transform", "output", "ai", "io"] as const;

interface LoadedNotebook {
  name: string;
  cells: NotebookCell[];
  doc: IpynbDoc;
}

type DragAxis = "horizontal" | "vertical";

interface DragState {
  axis: DragAxis;
  startCoord: number;
  startRatio: number;
}

export function App(): ReactElement {
  const [notebook, setNotebook] = useState<LoadedNotebook>(() => bootstrapFromFixture());
  const [graph, setGraph] = useState<GraphModel>(EMPTY_GRAPH);
  const [selected, setSelected] = useState<NodeModel | null>(null);
  const [patches, setPatches] = useState<CellPatch[]>([]);
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [outputsByCell, setOutputsByCell] = useState<Record<number, NbOutput[]>>({});
  const [definedByCell, setDefinedByCell] = useState<string[][]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paletteNodes, setPaletteNodes] = useState<NodeManifestDef[]>([]);
  const [paletteError, setPaletteError] = useState<string | null>(null);
  const [notebookRatio, setNotebookRatio] = useState(DEFAULT_NOTEBOOK_RATIO);
  const [mainRatio, setMainRatio] = useState(DEFAULT_MAIN_RATIO);
  const [paletteWidth, setPaletteWidth] = useState(DEFAULT_PALETTE_WIDTH_PX);
  const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(false);
  const [paletteDragState, setPaletteDragState] = useState<{
    startCoord: number;
    startWidth: number;
  } | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const clientRef = useRef<EngineClient>(new EngineClient());
  const contentRef = useRef<HTMLDivElement | null>(null);
  const topPaneRef = useRef<HTMLDivElement | null>(null);
  const canvasPaneRef = useRef<HTMLDivElement | null>(null);

  // Lazily construct the SyncEngine once. We re-call ingest whenever the
  // notebook's cell array changes (drop, edit-debounce, re-ingest button).
  useEffect(() => {
    const engine = new SyncEngine({
      onGraphUpdate: setGraph,
      onCellPatch: (patch: CellPatch): Promise<void> => {
        setPatches((prev) => [...prev, patch]);
        setNotebook((prev) => applyCellPatch(prev, patch));
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
      setOutputsByCell({});
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

  const handleInputsChange = useCallback((nodeId: string, nextInputs: string[]): void => {
    void engineRef.current?.setNodeInputs(nodeId, nextInputs, Date.now());
  }, []);

  const handleOutputsChange = useCallback((nodeId: string, nextOutputs: string[]): void => {
    void engineRef.current?.setNodeOutputs(nodeId, nextOutputs, Date.now());
  }, []);

  const handleAddNode = useCallback(
    (manifest: NodeManifestDef): void => {
      void engineRef.current?.createNode(
        notebook.name,
        {
          name: manifest.name,
          tag: manifest.tag as "input" | "transform" | "output" | "ai" | "io",
          outputs: manifest.outputs.map((port) => port.name),
          bodySource: manifest.template,
          metadata: {
            notebookflow: {
              manifestId: manifest.id,
              manifestVersion: manifest.version,
            },
          },
        },
        Date.now(),
      );
    },
    [notebook.name],
  );

  // Ask the engine to statically analyze cell sources so port autocomplete can
  // suggest real variable names. Debounced and re-run whenever cells change.
  useEffect(() => {
    let cancelled = false;
    const sources = notebook.cells.map((cell) => cell.source);
    const timer = window.setTimeout(() => {
      void clientRef.current.analyzeCells(sources).then((result) => {
        if (!cancelled) {
          setDefinedByCell(result);
        }
      });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [notebook.cells]);

  useEffect(() => {
    let cancelled = false;
    void clientRef.current
      .listNodes()
      .then((nodes) => {
        if (cancelled) {
          return;
        }
        setPaletteNodes(sortPalette(nodes));
        setPaletteError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        const message = err instanceof Error ? err.message : "unknown error";
        setPaletteError(`Could not load node registry: ${message}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Map each node to the variable names defined across its cell(s).
  const variablesByNode = useMemo<Record<string, string[]>>(() => {
    const result: Record<string, string[]> = {};
    for (const node of Object.values(graph.nodes)) {
      const names = new Set<string>();
      for (const cellIndex of node.cellIndices) {
        for (const name of definedByCell[cellIndex] ?? []) {
          names.add(name);
        }
      }
      result[node.id] = [...names];
    }
    return result;
  }, [graph, definedByCell]);

  const pipelineDef = useMemo<PipelineDef>(
    () => buildPipelineDef(graph, notebook.cells, notebook.name),
    [graph, notebook],
  );

  const handleRun = useCallback((): void => {
    if (isRunning) {
      return;
    }
    setEvents([]);
    setOutputsByCell({});
    setIsRunning(true);
    setError(null);
    clientRef.current
      .runPipeline({
        pipelineId: `web-${String(Date.now())}`,
        pipeline: pipelineDef,
        onEvent: (event) => {
          setEvents((prev) => [...prev, event]);
          if (event.type === "nodeCompleted") {
            const node = graph.nodes[event.result.nodeId];
            const cellIndex = node?.cellIndices[0];
            if (cellIndex !== undefined) {
              setOutputsByCell((prev) => ({ ...prev, [cellIndex]: event.result.outputs }));
            }
          }
        },
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "unknown error";
        setError(`Pipeline run failed: ${message}`);
      })
      .finally(() => {
        setIsRunning(false);
      });
  }, [isRunning, pipelineDef, graph]);

  const handleDownload = useCallback((): void => {
    downloadNotebook(notebook.cells, notebook.doc, notebook.name, outputsByCell);
  }, [notebook, outputsByCell]);

  const handleReingest = useCallback((): void => {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    setPatches([]);
    void engine.ingestNotebook(notebook.name, notebook.cells, Date.now());
  }, [notebook]);

  const nodeCount = Object.keys(graph.nodes).length;
  const minCanvasPaneWidth = isPaletteCollapsed
    ? MIN_CANVAS_BODY_WIDTH_PX
    : MIN_PALETTE_WIDTH_PX + DIVIDER_SIZE_PX + MIN_CANVAS_BODY_WIDTH_PX;

  const clampNotebookRatio = useCallback(
    (value: number): number => {
      const host = topPaneRef.current;
      if (host === null) {
        return clamp(value, 0, 100);
      }
      const availableWidth = Math.max(host.clientWidth - DIVIDER_SIZE_PX, 1);
      const minRatio = Math.min((MIN_NOTEBOOK_WIDTH_PX / availableWidth) * 100, 50);
      const maxRatio = Math.max(100 - (minCanvasPaneWidth / availableWidth) * 100, 50);
      return clamp(value, minRatio, maxRatio);
    },
    [minCanvasPaneWidth],
  );

  const clampPaletteWidth = useCallback((value: number): number => {
    const host = canvasPaneRef.current;
    if (host === null) {
      return Math.max(value, MIN_PALETTE_WIDTH_PX);
    }
    const maxWidth = Math.max(host.clientWidth - DIVIDER_SIZE_PX - MIN_CANVAS_BODY_WIDTH_PX, 0);
    const minWidth = Math.min(MIN_PALETTE_WIDTH_PX, maxWidth);
    return clamp(value, minWidth, maxWidth);
  }, []);

  const clampMainRatio = useCallback((value: number): number => {
    const host = contentRef.current;
    if (host === null) {
      return clamp(value, 0, 100);
    }
    const availableHeight = Math.max(host.clientHeight - DIVIDER_SIZE_PX, 1);
    const minRatio = Math.min((MIN_MAIN_HEIGHT_PX / availableHeight) * 100, 50);
    const maxRatio = Math.max(100 - (MIN_INSPECTOR_HEIGHT_PX / availableHeight) * 100, 50);
    return clamp(value, minRatio, maxRatio);
  }, []);

  useEffect(() => {
    if (dragState === null) {
      return;
    }

    const handlePointerMove = (event: PointerEvent): void => {
      if (dragState.axis === "vertical") {
        const host = topPaneRef.current;
        if (host === null) {
          return;
        }
        const availableWidth = Math.max(host.clientWidth - DIVIDER_SIZE_PX, 1);
        const deltaRatio = ((event.clientX - dragState.startCoord) / availableWidth) * 100;
        setNotebookRatio(clampNotebookRatio(dragState.startRatio + deltaRatio));
        return;
      }

      const host = contentRef.current;
      if (host === null) {
        return;
      }
      const availableHeight = Math.max(host.clientHeight - DIVIDER_SIZE_PX, 1);
      const deltaRatio = ((event.clientY - dragState.startCoord) / availableHeight) * 100;
      setMainRatio(clampMainRatio(dragState.startRatio + deltaRatio));
    };

    const handlePointerUp = (): void => {
      setDragState(null);
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = dragState.axis === "vertical" ? "col-resize" : "row-resize";

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [clampMainRatio, clampNotebookRatio, dragState]);

  useEffect(() => {
    if (paletteDragState === null) {
      return;
    }

    const handlePointerMove = (event: PointerEvent): void => {
      const nextWidth = paletteDragState.startWidth - (event.clientX - paletteDragState.startCoord);
      setPaletteWidth(clampPaletteWidth(nextWidth));
    };

    const handlePointerUp = (): void => {
      setPaletteDragState(null);
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [clampPaletteWidth, paletteDragState]);

  useEffect(() => {
    if (isPaletteCollapsed) {
      return;
    }
    const syncPaletteWidth = (): void => {
      setPaletteWidth((current) => clampPaletteWidth(current));
    };
    syncPaletteWidth();
    window.addEventListener("resize", syncPaletteWidth);
    return () => {
      window.removeEventListener("resize", syncPaletteWidth);
    };
  }, [clampPaletteWidth, isPaletteCollapsed]);

  const handleVerticalDividerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      setDragState({
        axis: "vertical",
        startCoord: event.clientX,
        startRatio: notebookRatio,
      });
    },
    [notebookRatio],
  );

  const handleHorizontalDividerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      setDragState({
        axis: "horizontal",
        startCoord: event.clientY,
        startRatio: mainRatio,
      });
    },
    [mainRatio],
  );

  const handlePaletteDividerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      setPaletteDragState({
        startCoord: event.clientX,
        startWidth: paletteWidth,
      });
    },
    [paletteWidth],
  );

  const handleVerticalDividerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setNotebookRatio((current) => clampNotebookRatio(current - KEYBOARD_RESIZE_STEP));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setNotebookRatio((current) => clampNotebookRatio(current + KEYBOARD_RESIZE_STEP));
      } else if (event.key === "Home") {
        event.preventDefault();
        setNotebookRatio(() => clampNotebookRatio(0));
      } else if (event.key === "End") {
        event.preventDefault();
        setNotebookRatio(() => clampNotebookRatio(100));
      }
    },
    [clampNotebookRatio],
  );

  const handleHorizontalDividerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMainRatio((current) => clampMainRatio(current - KEYBOARD_RESIZE_STEP));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setMainRatio((current) => clampMainRatio(current + KEYBOARD_RESIZE_STEP));
      } else if (event.key === "Home") {
        event.preventDefault();
        setMainRatio(() => clampMainRatio(0));
      } else if (event.key === "End") {
        event.preventDefault();
        setMainRatio(() => clampMainRatio(100));
      }
    },
    [clampMainRatio],
  );

  const handlePaletteDividerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setPaletteWidth((current) => clampPaletteWidth(current + 16));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setPaletteWidth((current) => clampPaletteWidth(current - 16));
      } else if (event.key === "Home") {
        event.preventDefault();
        setIsPaletteCollapsed(true);
      } else if (event.key === "End") {
        event.preventDefault();
        setPaletteWidth(() => clampPaletteWidth(Number.POSITIVE_INFINITY));
      }
    },
    [clampPaletteWidth],
  );

  const handleTogglePalette = useCallback((): void => {
    if (isPaletteCollapsed) {
      setIsPaletteCollapsed(false);
      setPaletteWidth((current) => {
        const fallbackWidth = current === 0 ? DEFAULT_PALETTE_WIDTH_PX : current;
        return clampPaletteWidth(fallbackWidth);
      });
      return;
    }
    setIsPaletteCollapsed(true);
  }, [clampPaletteWidth, isPaletteCollapsed]);

  const contentStyle = useMemo(
    () => ({
      gridTemplateRows: `minmax(${MIN_MAIN_HEIGHT_PX}px, ${mainRatio}%) ${DIVIDER_SIZE_PX}px minmax(${MIN_INSPECTOR_HEIGHT_PX}px, calc(${100 - mainRatio}% - ${DIVIDER_SIZE_PX}px))`,
    }),
    [mainRatio],
  );

  const topPaneStyle = useMemo(
    () => ({
      gridTemplateColumns: `minmax(${MIN_NOTEBOOK_WIDTH_PX}px, ${notebookRatio}%) ${DIVIDER_SIZE_PX}px minmax(${minCanvasPaneWidth}px, calc(${100 - notebookRatio}% - ${DIVIDER_SIZE_PX}px))`,
    }),
    [minCanvasPaneWidth, notebookRatio],
  );

  const canvasPaneStyle = useMemo(
    () => ({
      gridTemplateColumns: isPaletteCollapsed
        ? "minmax(0, 1fr)"
        : `minmax(${MIN_CANVAS_BODY_WIDTH_PX}px, 1fr) ${DIVIDER_SIZE_PX}px ${paletteWidth}px`,
    }),
    [isPaletteCollapsed, paletteWidth],
  );

  return (
    <FileDropZone onFile={handleFile}>
      <div className="flex h-screen overflow-hidden flex-col bg-background text-foreground font-sans">
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

        <div ref={contentRef} className="grid min-h-0 flex-1 overflow-hidden" style={contentStyle}>
          <div ref={topPaneRef} className="grid min-h-0 overflow-hidden" style={topPaneStyle}>
            <section className="flex min-h-0 min-w-0 flex-col">
              <div className="border-b px-4 py-2 text-xs text-muted-foreground">Cells</div>
              <ScrollArea className="min-h-0 flex-1">
                <CellList
                  cells={notebook.cells}
                  onCellsChange={handleCellsChange}
                  outputsByCell={outputsByCell}
                />
              </ScrollArea>
            </section>

            <PaneDivider
              orientation="vertical"
              label="Resize notebook and canvas panes"
              onPointerDown={handleVerticalDividerPointerDown}
              onKeyDown={handleVerticalDividerKeyDown}
            />

            <section className="flex min-h-0 min-w-0 flex-col">
              <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
                <span>Canvas</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {paletteNodes.length}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={handleTogglePalette}
                  >
                    {isPaletteCollapsed ? "Show palette" : "Hide palette"}
                  </Button>
                </div>
              </div>
              <div
                ref={canvasPaneRef}
                className="grid min-h-0 flex-1 overflow-hidden bg-background"
                style={canvasPaneStyle}
              >
                <div className="relative min-h-0 flex-1">
                  <Canvas
                    graph={graph}
                    onNodeRename={handleRename}
                    onNodeSelect={setSelected}
                    onInputsChange={handleInputsChange}
                    onOutputsChange={handleOutputsChange}
                    variablesByNode={variablesByNode}
                  />
                </div>

                {!isPaletteCollapsed && (
                  <PaneDivider
                    orientation="vertical"
                    label="Resize palette and canvas panes"
                    onPointerDown={handlePaletteDividerPointerDown}
                    onKeyDown={handlePaletteDividerKeyDown}
                  />
                )}

                {!isPaletteCollapsed && (
                  <section className="flex min-h-0 min-w-0 flex-col border-l bg-muted/20">
                    <div className="flex items-center gap-2 border-b px-4 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                      Palette
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {paletteNodes.length}
                      </Badge>
                    </div>
                    <ScrollArea className="min-h-0 flex-1">
                      <div className="flex flex-col gap-3 p-3">
                        {paletteError !== null ? (
                          <p className="text-[11px] italic text-muted-foreground">{paletteError}</p>
                        ) : paletteNodes.length === 0 ? (
                          <p className="text-[11px] italic text-muted-foreground">
                            Loading node registry…
                          </p>
                        ) : (
                          groupPalette(paletteNodes).map(([tag, nodes]) => (
                            <section key={tag} className="flex flex-col gap-2">
                              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                                {tag}
                              </div>
                              <div className="flex flex-col gap-2">
                                {nodes.map((manifest) => (
                                  <button
                                    key={manifest.id}
                                    type="button"
                                    onClick={() => {
                                      handleAddNode(manifest);
                                    }}
                                    className="rounded-md border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/70"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-sm font-medium">{manifest.name}</span>
                                      <Badge variant="secondary" className="font-mono text-[10px]">
                                        {manifest.tag}
                                      </Badge>
                                    </div>
                                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                                      {manifest.id}
                                    </div>
                                    {manifest.description !== "" && (
                                      <p className="mt-2 whitespace-pre-wrap text-[11px] text-muted-foreground">
                                        {manifest.description}
                                      </p>
                                    )}
                                  </button>
                                ))}
                              </div>
                            </section>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </section>
                )}
              </div>
            </section>
          </div>

          <PaneDivider
            orientation="horizontal"
            label="Resize editor and inspector panes"
            onPointerDown={handleHorizontalDividerPointerDown}
            onKeyDown={handleHorizontalDividerKeyDown}
          />

          <aside className="min-h-0 grid grid-cols-3 divide-x bg-muted/30 text-xs">
            <InspectorPanel
              title="Selected"
              count={selected === null ? 0 : 1}
              empty="Click a node."
            >
              <pre className="overflow-x-auto rounded-md border bg-background p-2 font-mono text-[11px]">
                {JSON.stringify(selected, null, 2)}
              </pre>
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
                    <Badge variant="outline" className="font-mono uppercase">
                      {patch.operation}
                    </Badge>
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
      </div>
    </FileDropZone>
  );
}

interface PaneDividerProps {
  orientation: DragAxis;
  label: string;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}

function PaneDivider({
  orientation,
  label,
  onPointerDown,
  onKeyDown,
}: PaneDividerProps): ReactElement {
  const isVertical = orientation === "vertical";

  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        "group relative flex shrink-0 touch-none select-none items-center justify-center border-0 bg-muted/70 p-0",
        isVertical ? "h-full cursor-col-resize" : "w-full cursor-row-resize",
      )}
    >
      <div
        className={cn(
          "rounded-full bg-border transition-colors group-hover:bg-foreground/30 group-active:bg-foreground/45",
          isVertical ? "h-14 w-1" : "h-1 w-14",
        )}
      />
    </button>
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
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {title}
        <Badge variant="outline" className="font-mono text-[10px]">
          {count}
        </Badge>
      </div>
      <ScrollArea className="min-h-0 flex-1">
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function applyCellPatch(prev: LoadedNotebook, patch: CellPatch): LoadedNotebook {
  if (patch.operation === "insert") {
    if (patch.newSource === null || patch.cellIndex < 0 || patch.cellIndex > prev.cells.length) {
      return prev;
    }
    const nextCell: NotebookCell = {
      cellType: patch.cellType ?? "code",
      source: patch.newSource,
      ...(patch.metadata === undefined ? {} : { metadata: patch.metadata }),
    };
    const nextCells = prev.cells.slice();
    nextCells.splice(patch.cellIndex, 0, nextCell);
    const nextDocCells = prev.doc.cells.slice();
    nextDocCells.splice(patch.cellIndex, 0, toIpynbCell(nextCell));
    return { ...prev, cells: nextCells, doc: { ...prev.doc, cells: nextDocCells } };
  }

  if (patch.operation === "delete") {
    if (patch.cellIndex < 0 || patch.cellIndex >= prev.cells.length) {
      return prev;
    }
    const nextCells = prev.cells.slice();
    nextCells.splice(patch.cellIndex, 1);
    const nextDocCells = prev.doc.cells.slice();
    nextDocCells.splice(patch.cellIndex, 1);
    return { ...prev, cells: nextCells, doc: { ...prev.doc, cells: nextDocCells } };
  }

  if (patch.cellIndex < 0 || patch.cellIndex >= prev.cells.length || patch.newSource === null) {
    return prev;
  }
  const cell = prev.cells[patch.cellIndex];
  const docCell = prev.doc.cells[patch.cellIndex];
  if (cell === undefined || docCell === undefined) {
    return prev;
  }
  const nextMetadata = patch.metadata ?? cell.metadata;
  if (cell.source === patch.newSource && nextMetadata === cell.metadata) {
    return prev;
  }
  const nextCells = prev.cells.slice();
  nextCells[patch.cellIndex] = {
    ...cell,
    source: patch.newSource,
    ...(nextMetadata === undefined ? {} : { metadata: nextMetadata }),
  };
  const nextDocCells = prev.doc.cells.slice();
  nextDocCells[patch.cellIndex] = {
    ...docCell,
    source: [patch.newSource],
    metadata: nextMetadata ?? docCell.metadata ?? {},
  };
  return { ...prev, cells: nextCells, doc: { ...prev.doc, cells: nextDocCells } };
}

function groupPalette(
  nodes: NodeManifestDef[],
): Array<[NodeManifestDef["tag"], NodeManifestDef[]]> {
  const groups: Array<[NodeManifestDef["tag"], NodeManifestDef[]]> = [];
  for (const tag of TAG_ORDER) {
    const groupNodes = nodes.filter((node) => node.tag === tag);
    if (groupNodes.length > 0) {
      groups.push([tag, groupNodes]);
    }
  }
  return groups;
}

function sortPalette(nodes: NodeManifestDef[]): NodeManifestDef[] {
  const rank = new Map(TAG_ORDER.map((tag, idx) => [tag, idx]));
  return [...nodes].sort((left, right) => {
    const tagDelta = (rank.get(left.tag) ?? 999) - (rank.get(right.tag) ?? 999);
    if (tagDelta !== 0) {
      return tagDelta;
    }
    return left.name.localeCompare(right.name);
  });
}
