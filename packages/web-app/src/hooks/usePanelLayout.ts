/**
 * Workspace panel layout — pane split ratios, collapse flags, sidebar width,
 * divider drag / keyboard resize handlers, and the grid style memos. Collapse
 * flags persist to localStorage (readPanelLayout seeds the initial state).
 * Also exposes the workspace import/export seams: applyWorkspaceUi and
 * collectUiState.
 */

import type {
  CSSProperties,
  Dispatch,
  MutableRefObject,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceUiState } from "@/lib/notebooksApi";
import {
  clampOptionalRatio,
  clampSidebarWidthValue,
  DEFAULT_MAIN_RATIO,
  DEFAULT_NOTEBOOK_RATIO,
  DEFAULT_SIDEBAR_WIDTH_PX,
  DIVIDER_SIZE_PX,
  KEYBOARD_RESIZE_STEP,
  MIN_CANVAS_BODY_WIDTH_PX,
  MIN_INSPECTOR_HEIGHT_PX,
  MIN_MAIN_HEIGHT_PX,
  MIN_NOTEBOOK_WIDTH_PX,
  PANEL_STORAGE_KEY,
  readPanelLayout,
} from "@/lib/panels";
import { clamp } from "@/lib/utils";
import type { DragState } from "@/types/workspace";

type DividerPointerHandler = (event: ReactPointerEvent<HTMLButtonElement>) => void;
type DividerKeyHandler = (event: ReactKeyboardEvent<HTMLButtonElement>) => void;

export interface PanelLayout {
  isFilesCollapsed: boolean;
  setIsFilesCollapsed: Dispatch<SetStateAction<boolean>>;
  isCellsCollapsed: boolean;
  setIsCellsCollapsed: Dispatch<SetStateAction<boolean>>;
  isInspectorCollapsed: boolean;
  setIsInspectorCollapsed: Dispatch<SetStateAction<boolean>>;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  showMinimap: boolean;
  setShowMinimap: Dispatch<SetStateAction<boolean>>;
  contentRef: MutableRefObject<HTMLDivElement | null>;
  topPaneRef: MutableRefObject<HTMLDivElement | null>;
  canvasPaneRef: MutableRefObject<HTMLDivElement | null>;
  canvasBodyRef: MutableRefObject<HTMLDivElement | null>;
  contentStyle: CSSProperties;
  topPaneStyle: CSSProperties;
  canvasBodyStyle: CSSProperties;
  toggleSidebar: () => void;
  handleVerticalDividerPointerDown: DividerPointerHandler;
  handleVerticalDividerKeyDown: DividerKeyHandler;
  handleHorizontalDividerPointerDown: DividerPointerHandler;
  handleHorizontalDividerKeyDown: DividerKeyHandler;
  handleSidebarDividerPointerDown: DividerPointerHandler;
  handleSidebarDividerKeyDown: DividerKeyHandler;
  applyWorkspaceUi: (ui: WorkspaceUiState | undefined) => void;
  collectUiState: () => WorkspaceUiState;
}

export function usePanelLayout(): PanelLayout {
  // Files list and code cells collapse independently — close files without
  // closing code, and vice-versa.
  const [isFilesCollapsed, setIsFilesCollapsed] = useState(() => readPanelLayout().filesCollapsed);
  const [isCellsCollapsed, setIsCellsCollapsed] = useState(() => readPanelLayout().cellsCollapsed);
  const [notebookRatio, setNotebookRatio] = useState(DEFAULT_NOTEBOOK_RATIO);
  const [mainRatio, setMainRatio] = useState(DEFAULT_MAIN_RATIO);
  // Right sidebar: selected node + node palette (Alt+A or the canvas toggle).
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => readPanelLayout().sidebarCollapsed,
  );
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH_PX);
  const lastOpenSidebarWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH_PX);
  const [showMinimap, setShowMinimap] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(
    () => readPanelLayout().inspectorCollapsed,
  );
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [sidebarDragState, setSidebarDragState] = useState<{
    startCoord: number;
    startWidth: number;
  } | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const topPaneRef = useRef<HTMLDivElement | null>(null);
  const canvasPaneRef = useRef<HTMLDivElement | null>(null);
  const canvasBodyRef = useRef<HTMLDivElement | null>(null);

  // Persist panel collapse state so reloads keep the user's layout.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(
        PANEL_STORAGE_KEY,
        JSON.stringify({
          filesCollapsed: isFilesCollapsed,
          cellsCollapsed: isCellsCollapsed,
          inspectorCollapsed: isInspectorCollapsed,
          sidebarCollapsed: isSidebarCollapsed,
        }),
      );
    } catch {
      // Quota / disabled storage -- silently keep working in-memory.
    }
  }, [isFilesCollapsed, isCellsCollapsed, isInspectorCollapsed, isSidebarCollapsed]);

  const applyWorkspaceUi = useCallback((ui: WorkspaceUiState | undefined): void => {
    if (ui === undefined) {
      return;
    }
    setNotebookRatio((current) => clampOptionalRatio(ui.notebookRatio, current));
    setMainRatio((current) => clampOptionalRatio(ui.mainRatio, current));
    if (typeof ui.sidebarWidth === "number") {
      const nextSidebarWidth = clampSidebarWidthValue(
        ui.sidebarWidth,
        canvasBodyRef.current ?? canvasPaneRef.current,
      );
      setSidebarWidth(nextSidebarWidth);
      lastOpenSidebarWidthRef.current = nextSidebarWidth;
    }
    if (typeof ui.filesCollapsed === "boolean") {
      setIsFilesCollapsed(ui.filesCollapsed);
    }
    if (typeof ui.cellsCollapsed === "boolean") {
      setIsCellsCollapsed(ui.cellsCollapsed);
    }
    if (typeof ui.inspectorCollapsed === "boolean") {
      setIsInspectorCollapsed(ui.inspectorCollapsed);
    }
    if (typeof ui.sidebarCollapsed === "boolean") {
      setIsSidebarCollapsed(ui.sidebarCollapsed);
    }
    if (typeof ui.showMinimap === "boolean") {
      setShowMinimap(ui.showMinimap);
    }
  }, []);

  const collectUiState = useCallback(
    (): WorkspaceUiState => ({
      notebookRatio,
      mainRatio,
      filesCollapsed: isFilesCollapsed,
      cellsCollapsed: isCellsCollapsed,
      inspectorCollapsed: isInspectorCollapsed,
      sidebarCollapsed: isSidebarCollapsed,
      sidebarWidth,
      showMinimap,
    }),
    [
      notebookRatio,
      mainRatio,
      isFilesCollapsed,
      isCellsCollapsed,
      isInspectorCollapsed,
      isSidebarCollapsed,
      sidebarWidth,
      showMinimap,
    ],
  );

  const clampNotebookRatio = useCallback((value: number): number => {
    const host = topPaneRef.current;
    if (host === null) {
      return clamp(value, 0, 100);
    }
    const availableWidth = Math.max(host.clientWidth - DIVIDER_SIZE_PX, 1);
    const minRatio = Math.min((MIN_NOTEBOOK_WIDTH_PX / availableWidth) * 100, 50);
    const maxRatio = Math.max(100 - (MIN_CANVAS_BODY_WIDTH_PX / availableWidth) * 100, 50);
    return clamp(value, minRatio, maxRatio);
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

  const clampSidebarWidth = useCallback((value: number): number => {
    return clampSidebarWidthValue(value, canvasBodyRef.current ?? canvasPaneRef.current);
  }, []);

  const toggleSidebar = useCallback((): void => {
    setIsSidebarCollapsed((collapsed) => {
      if (collapsed) {
        setSidebarWidth(clampSidebarWidth(lastOpenSidebarWidthRef.current));
        return false;
      }
      lastOpenSidebarWidthRef.current = sidebarWidth;
      return true;
    });
  }, [clampSidebarWidth, sidebarWidth]);

  useEffect(() => {
    if (!isSidebarCollapsed) {
      lastOpenSidebarWidthRef.current = sidebarWidth;
    }
  }, [isSidebarCollapsed, sidebarWidth]);

  useEffect(() => {
    if (sidebarDragState === null) {
      return;
    }

    const handlePointerMove = (event: PointerEvent): void => {
      const nextWidth = sidebarDragState.startWidth - (event.clientX - sidebarDragState.startCoord);
      setSidebarWidth(clampSidebarWidth(nextWidth));
    };

    const handlePointerUp = (): void => {
      setSidebarDragState(null);
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
  }, [clampSidebarWidth, sidebarDragState]);

  useEffect(() => {
    const handleResize = (): void => {
      if (!isSidebarCollapsed) {
        setSidebarWidth((current) => clampSidebarWidth(current));
      }
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [clampSidebarWidth, isSidebarCollapsed]);

  const handleSidebarDividerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      setSidebarDragState({ startCoord: event.clientX, startWidth: sidebarWidth });
    },
    [sidebarWidth],
  );

  const handleSidebarDividerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setSidebarWidth((current) => clampSidebarWidth(current + KEYBOARD_RESIZE_STEP * 8));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setSidebarWidth((current) => clampSidebarWidth(current - KEYBOARD_RESIZE_STEP * 8));
      }
    },
    [clampSidebarWidth],
  );

  const contentStyle = useMemo(
    () =>
      isInspectorCollapsed
        ? { gridTemplateRows: "minmax(0, 1fr)" }
        : {
            gridTemplateRows: `minmax(${MIN_MAIN_HEIGHT_PX}px, ${mainRatio}%) ${DIVIDER_SIZE_PX}px minmax(${MIN_INSPECTOR_HEIGHT_PX}px, calc(${100 - mainRatio}% - ${DIVIDER_SIZE_PX}px))`,
          },
    [isInspectorCollapsed, mainRatio],
  );

  const topPaneStyle = useMemo(
    () =>
      isCellsCollapsed
        ? // Code collapsed: a slim strip (wide enough for the expand button)
          // plus the canvas.
          { gridTemplateColumns: `2.25rem minmax(${MIN_CANVAS_BODY_WIDTH_PX}px, 1fr)` }
        : {
            gridTemplateColumns: `minmax(${MIN_NOTEBOOK_WIDTH_PX}px, ${notebookRatio}%) ${DIVIDER_SIZE_PX}px minmax(${MIN_CANVAS_BODY_WIDTH_PX}px, calc(${100 - notebookRatio}% - ${DIVIDER_SIZE_PX}px))`,
          },
    [isCellsCollapsed, notebookRatio],
  );

  const canvasBodyStyle = useMemo(
    () =>
      isSidebarCollapsed
        ? { gridTemplateColumns: "minmax(0, 1fr)" }
        : {
            gridTemplateColumns: `minmax(0, 1fr) ${DIVIDER_SIZE_PX}px ${sidebarWidth}px`,
          },
    [isSidebarCollapsed, sidebarWidth],
  );

  return {
    isFilesCollapsed,
    setIsFilesCollapsed,
    isCellsCollapsed,
    setIsCellsCollapsed,
    isInspectorCollapsed,
    setIsInspectorCollapsed,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    showMinimap,
    setShowMinimap,
    contentRef,
    topPaneRef,
    canvasPaneRef,
    canvasBodyRef,
    contentStyle,
    topPaneStyle,
    canvasBodyStyle,
    toggleSidebar,
    handleVerticalDividerPointerDown,
    handleVerticalDividerKeyDown,
    handleHorizontalDividerPointerDown,
    handleHorizontalDividerKeyDown,
    handleSidebarDividerPointerDown,
    handleSidebarDividerKeyDown,
    applyWorkspaceUi,
    collectUiState,
  };
}
