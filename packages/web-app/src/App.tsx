/**
 * Standalone web app — end-to-end demo of the sync core.
 *
 * On mount, ingests `fixtures/two-node.ipynb.json` through a SyncEngine,
 * renders the resulting graph in the shared Canvas, and exposes a side
 * panel showing the cell patches that the engine emits when the user
 * double-clicks a node to rename it. No remote engine yet — Phase-2 runs
 * entirely client-side against the in-memory SyncEngine.
 */

import type { GraphModel, NodeModel } from "@notebookflow/graph-canvas";
import { Canvas } from "@notebookflow/graph-canvas";
import type { CellPatch, NotebookCell } from "@notebookflow/graph-canvas/sync";
import { SyncEngine } from "@notebookflow/graph-canvas/sync";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

import twoNode from "./fixtures/two-node.ipynb.json";

interface IpynbCell {
  cell_type: string;
  source: string | string[];
}
interface IpynbDoc {
  cells: IpynbCell[];
}

function toNotebookCells(doc: IpynbDoc): NotebookCell[] {
  return doc.cells.map((c) => ({
    cellType: c.cell_type as NotebookCell["cellType"],
    source: Array.isArray(c.source) ? c.source.join("") : c.source,
  }));
}

const NOTEBOOK_PATH = "demo.ipynb";
const EMPTY_GRAPH: GraphModel = { nodes: {}, groups: {}, wires: {} };

export function App(): ReactElement {
  const [graph, setGraph] = useState<GraphModel>(EMPTY_GRAPH);
  const [patches, setPatches] = useState<CellPatch[]>([]);
  const [selected, setSelected] = useState<NodeModel | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);

  useEffect(() => {
    const engine = new SyncEngine({
      onGraphUpdate: setGraph,
      onCellPatch: (patch: CellPatch): Promise<void> => {
        setPatches((prev) => [...prev, patch]);
        return Promise.resolve();
      },
    });
    engineRef.current = engine;
    const cells = toNotebookCells(twoNode);
    void engine.ingestNotebook(NOTEBOOK_PATH, cells, Date.now());
  }, []);

  const handleRename = (nodeId: string, nextName: string): void => {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    void engine.renameNode(nodeId, nextName, Date.now());
  };

  const handleReingest = (): void => {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    setPatches([]);
    const cells = toNotebookCells(twoNode);
    void engine.ingestNotebook(NOTEBOOK_PATH, cells, Date.now());
  };

  const handleClearPatches = (): void => {
    setPatches([]);
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground font-sans">
      <header className="flex items-center gap-3 border-b bg-card px-4 py-2.5">
        <span className="font-semibold tracking-tight">NotebookFlow</span>
        <Badge variant="secondary" className="font-normal">
          Phase 2 — sync demo
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleReingest}>
            Re-ingest fixture
          </Button>
          <Button variant="ghost" size="sm" onClick={handleClearPatches}>
            Clear patches
          </Button>
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        <main className="relative flex-1 bg-background">
          <Canvas graph={graph} onNodeRename={handleRename} onNodeSelect={setSelected} />
        </main>
        <Separator orientation="vertical" />
        <aside className="flex w-96 flex-col bg-muted/30">
          <div className="border-b px-4 py-2.5">
            <h2 className="text-sm font-semibold">Inspector</h2>
            <p className="text-xs text-muted-foreground">
              Double-click a node header to rename it.
            </p>
          </div>
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-4 p-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Selected node</CardTitle>
                  <CardDescription>
                    {selected === null
                      ? "Click a node to inspect it."
                      : `${selected.tag} · cell ${String(selected.cellIndices[0] ?? "?")}`}
                  </CardDescription>
                </CardHeader>
                {selected !== null && (
                  <CardContent>
                    <pre className="overflow-x-auto rounded-md border bg-background p-3 font-mono text-[11px] leading-relaxed">
                      {JSON.stringify(selected, null, 2)}
                    </pre>
                  </CardContent>
                )}
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    Cell patches
                    <Badge variant="outline" className="font-mono">
                      {patches.length}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    Marker rewrites the SyncEngine produced for the platform adapter.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {patches.length === 0 ? (
                    <p className="text-xs italic text-muted-foreground">
                      No patches yet. Rename a node to see one appear.
                    </p>
                  ) : (
                    patches.map((patch, idx) => (
                      <div
                        key={`${patch.notebookPath}-${String(patch.cellIndex)}-${String(idx)}`}
                        className="rounded-md border bg-background p-3"
                      >
                        <div className="mb-1.5 flex items-center gap-2 text-xs">
                          <Badge variant="secondary" className="font-mono">
                            cell {patch.cellIndex}
                          </Badge>
                          <span className="text-muted-foreground">{patch.notebookPath}</span>
                        </div>
                        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                          {patch.newSource ?? "(deleted)"}
                        </pre>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}
