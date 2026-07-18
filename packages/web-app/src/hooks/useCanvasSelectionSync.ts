/**
 * Canvas <-> notebook selection sync — the selected node, the focused cell,
 * and the scroll-to-cell navigation target, kept consistent as the graph
 * re-ingests and as selection hops between open notebooks.
 *
 * Other App flows (cell add/delete/paste, applying a Compose draft, document
 * resets) still write this state through the returned setters and `reset()`.
 */

import type { GraphModel, NodeModel } from "@notebookflow/graph-canvas";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { findNodeForCellIndex } from "@/lib/graphSelection";
import type { OpenFileMeta } from "@/types/workspace";

export interface CellNavigationTarget {
  index: number;
  revision: number;
}

export interface UseCanvasSelectionSyncOptions {
  graph: GraphModel;
  /** The active notebook's name (= its canvas group id). */
  activeName: string;
  openFiles: OpenFileMeta[];
  switchToFile: (targetId: string) => void;
  /** Reveal the cells pane when selecting a node navigates to its cell. */
  onRevealCells: () => void;
}

export interface CanvasSelectionSync {
  selected: NodeModel | null;
  setSelected: Dispatch<SetStateAction<NodeModel | null>>;
  focusedCellIndex: number | null;
  setFocusedCellIndex: Dispatch<SetStateAction<number | null>>;
  cellNavigationTarget: CellNavigationTarget | null;
  setCellNavigationTarget: Dispatch<SetStateAction<CellNavigationTarget | null>>;
  /** Focus a cell in the editor and mirror the selection onto the canvas. */
  handleFocusCell: (index: number) => void;
  /** Select a canvas node; switching files / revealing its cell as needed. */
  handleNodeSelect: (node: NodeModel | null) => void;
  /** Clear selection, cell focus, and the navigation target. */
  reset: () => void;
}

export function useCanvasSelectionSync({
  graph,
  activeName,
  openFiles,
  switchToFile,
  onRevealCells,
}: UseCanvasSelectionSyncOptions): CanvasSelectionSync {
  const [selected, setSelected] = useState<NodeModel | null>(null);
  const [focusedCellIndex, setFocusedCellIndex] = useState<number | null>(null);
  const [cellNavigationTarget, setCellNavigationTarget] = useState<CellNavigationTarget | null>(
    null,
  );

  // Re-resolve the selected node whenever the graph re-ingests, so the
  // inspector tracks renames/re-parses and drops nodes that disappeared.
  useEffect(() => {
    setSelected((current) => (current === null ? null : (graph.nodes[current.id] ?? null)));
  }, [graph]);

  const selectedCellIndexForActiveNotebook = useMemo(() => {
    if (selected === null || selected.groupId !== activeName) {
      return null;
    }
    return selected.cellIndices[0] ?? null;
  }, [activeName, selected]);

  useEffect(() => {
    if (selectedCellIndexForActiveNotebook !== null) {
      setFocusedCellIndex(selectedCellIndexForActiveNotebook);
    }
  }, [selectedCellIndexForActiveNotebook]);

  const handleFocusCell = useCallback(
    (index: number): void => {
      setFocusedCellIndex(index);
      setSelected(findNodeForCellIndex(graph, activeName, index));
    },
    [graph, activeName],
  );

  const handleNodeSelect = useCallback(
    (node: NodeModel | null): void => {
      if (node === null) {
        setSelected(null);
        return;
      }

      const targetFile =
        node.groupId === activeName ? null : openFiles.find((file) => file.name === node.groupId);
      if (targetFile !== null && targetFile !== undefined) {
        switchToFile(targetFile.id);
      }

      setSelected(node);
      const cellIndex = node.cellIndices[0] ?? null;
      const canNavigateToCell = node.groupId === activeName || targetFile !== undefined;
      if (cellIndex !== null && canNavigateToCell) {
        onRevealCells();
        setFocusedCellIndex(cellIndex);
        setCellNavigationTarget((current) => ({
          index: cellIndex,
          revision: (current?.revision ?? 0) + 1,
        }));
      }
    },
    [activeName, openFiles, switchToFile, onRevealCells],
  );

  const reset = useCallback((): void => {
    setSelected(null);
    setFocusedCellIndex(null);
    setCellNavigationTarget(null);
  }, []);

  return {
    selected,
    setSelected,
    focusedCellIndex,
    setFocusedCellIndex,
    cellNavigationTarget,
    setCellNavigationTarget,
    handleFocusCell,
    handleNodeSelect,
    reset,
  };
}
