/**
 * CellToolbar — editing toolbar above the cell list.
 *
 * Add / Cut / Copy / Paste / Delete operate on the focused cell, plus a
 * cell-type selector. There is deliberately no per-cell Run/Stop/Restart:
 * the pipeline runs from the top bar, so per-cell kernel controls would
 * only mislead.
 */

import type { NotebookCell } from "@notebookflow/graph-canvas/sync";
import { ChevronDown, Clipboard, Copy, Plus, Scissors, Trash2 } from "lucide-react";
import type { ChangeEvent, ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CellKind = NotebookCell["cellType"];

const CELL_KIND_LABELS: Record<CellKind, string> = {
  code: "Code",
  markdown: "Markdown",
  raw: "Raw",
};

export interface CellToolbarProps {
  focusedCellIndex: number | null;
  focusedCell: NotebookCell | null;
  hasClipboard: boolean;
  onAddCell: (kind: CellKind) => void;
  onDeleteCell: () => void;
  onCutCell: () => void;
  onCopyCell: () => void;
  onPasteCell: () => void;
  onChangeCellType: (kind: CellKind) => void;
  onAddCellMenuOpenChange?: (open: boolean) => void;
  isAddMenuOpen: boolean;
}

export function CellToolbar(props: CellToolbarProps): ReactElement {
  const {
    focusedCellIndex,
    focusedCell,
    hasClipboard,
    onAddCell,
    onDeleteCell,
    onCutCell,
    onCopyCell,
    onPasteCell,
    onChangeCellType,
    onAddCellMenuOpenChange,
    isAddMenuOpen,
  } = props;
  const focused = focusedCellIndex !== null && focusedCell !== null;

  const handleTypeChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const next = event.target.value as CellKind;
    if (next === "code" || next === "markdown" || next === "raw") {
      onChangeCellType(next);
    }
  };

  return (
    <div className="flex items-center gap-1 border-b bg-card/60 px-3 py-1.5">
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={() => {
            onAddCellMenuOpenChange?.(!isAddMenuOpen);
          }}
          title="Add a new cell at the end"
        >
          <Plus className="size-3.5" />
          Add
          <ChevronDown className="size-3" />
        </Button>
        {isAddMenuOpen && (
          <div
            className="absolute left-0 top-full z-10 mt-1 w-32 rounded-md border bg-popover text-popover-foreground shadow-md"
            // Keep menu open when clicking inside it; closes after a selection.
          >
            {(Object.keys(CELL_KIND_LABELS) as CellKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  onAddCell(kind);
                  onAddCellMenuOpenChange?.(false);
                }}
                className="block w-full px-2 py-1 text-left text-[11px] hover:bg-muted/70"
              >
                {CELL_KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        )}
      </div>

      <Separator />

      <ToolbarIconButton
        icon={<Scissors className="size-3.5" />}
        label="Cut"
        title="Cut the focused cell"
        disabled={!focused}
        onClick={onCutCell}
      />
      <ToolbarIconButton
        icon={<Copy className="size-3.5" />}
        label="Copy"
        title="Copy the focused cell"
        disabled={!focused}
        onClick={onCopyCell}
      />
      <ToolbarIconButton
        icon={<Clipboard className="size-3.5" />}
        label="Paste"
        title={
          hasClipboard
            ? focused
              ? "Paste below the focused cell"
              : "Paste at the end"
            : "Nothing in the clipboard"
        }
        disabled={!hasClipboard}
        onClick={onPasteCell}
      />
      <ToolbarIconButton
        icon={<Trash2 className="size-3.5" />}
        label="Delete"
        title="Delete the focused cell"
        disabled={!focused}
        onClick={onDeleteCell}
      />

      <Separator />

      <select
        value={focusedCell?.cellType ?? "code"}
        onChange={handleTypeChange}
        disabled={!focused}
        aria-label="Cell type"
        title={focused ? "Change the cell type" : "Focus a cell to change its type"}
        className={cn(
          "h-7 rounded-md border bg-background px-2 text-[11px]",
          focused ? "" : "cursor-not-allowed opacity-60",
        )}
      >
        {(Object.keys(CELL_KIND_LABELS) as CellKind[]).map((kind) => (
          <option key={kind} value={kind}>
            {CELL_KIND_LABELS[kind]}
          </option>
        ))}
      </select>

      <span className="ml-auto font-mono text-[10px] text-muted-foreground">
        {focusedCellIndex === null ? "—" : `cell ${String(focusedCellIndex)}`}
      </span>
    </div>
  );
}

function Separator(): ReactElement {
  return <span aria-hidden="true" className="mx-1 inline-block h-4 w-px bg-border" />;
}

interface ToolbarIconButtonProps {
  icon: ReactElement;
  label: string;
  title: string;
  disabled?: boolean;
  onClick?: () => void;
}

function ToolbarIconButton(props: ToolbarIconButtonProps): ReactElement {
  const { icon, label, title, disabled, onClick } = props;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1 px-2 text-[11px]"
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span className="hidden md:inline">{label}</span>
    </Button>
  );
}
