/**
 * NotebookBridge — adapter over the vscode.notebooks API.
 *
 * Translates VS Code's NotebookDocument cell model into the platform-neutral
 * NotebookCell shape consumed by the SyncEngine, and applies cell patches
 * back through a WorkspaceEdit so the user's undo stack stays intact.
 */

import type { CellPatch, NotebookCell } from "@notebookflow/graph-canvas/sync";
import * as vscode from "vscode";

export type NbOutput =
  | { output_type: "stream"; name: "stdout" | "stderr"; text: string }
  | {
      output_type: "display_data";
      data: Record<string, string>;
      metadata: Record<string, unknown>;
    }
  | {
      output_type: "execute_result";
      data: Record<string, string>;
      metadata: Record<string, unknown>;
    }
  | { output_type: "error"; ename: string; evalue: string; traceback: string[] };

export class NotebookBridge {
  private readonly doc: vscode.NotebookDocument;

  constructor(doc: vscode.NotebookDocument) {
    this.doc = doc;
  }

  get notebookPath(): string {
    return this.doc.uri.fsPath;
  }

  get document(): vscode.NotebookDocument {
    return this.doc;
  }

  readCells(): NotebookCell[] {
    return this.doc.getCells().map((cell) => ({
      cellType: cellKind(cell.kind),
      source: cell.document.getText(),
      metadata: cell.metadata,
    }));
  }

  async applyPatch(patch: CellPatch): Promise<void> {
    const edit = new vscode.WorkspaceEdit();

    if (patch.operation === "insert") {
      if (patch.newSource === null || patch.cellIndex < 0 || patch.cellIndex > this.doc.cellCount) {
        throw new Error(
          `NotebookBridge.applyPatch: insert cellIndex ${String(patch.cellIndex)} out of range`,
        );
      }
      const data = new vscode.NotebookCellData(
        toVsCodeCellKind(patch.cellType ?? "code"),
        patch.newSource,
        defaultLanguageId(patch.cellType ?? "code"),
      );
      data.metadata = { ...(patch.metadata ?? {}) };
      edit.set(this.doc.uri, [
        vscode.NotebookEdit.replaceCells(
          new vscode.NotebookRange(patch.cellIndex, patch.cellIndex),
          [data],
        ),
      ]);
    } else if (patch.operation === "delete" || patch.newSource === null) {
      if (patch.cellIndex < 0 || patch.cellIndex >= this.doc.cellCount) {
        throw new Error(
          `NotebookBridge.applyPatch: cellIndex ${String(patch.cellIndex)} out of range`,
        );
      }
      edit.set(this.doc.uri, [
        vscode.NotebookEdit.deleteCells(
          new vscode.NotebookRange(patch.cellIndex, patch.cellIndex + 1),
        ),
      ]);
    } else {
      if (patch.cellIndex < 0 || patch.cellIndex >= this.doc.cellCount) {
        throw new Error(
          `NotebookBridge.applyPatch: cellIndex ${String(patch.cellIndex)} out of range`,
        );
      }
      const cell = this.doc.cellAt(patch.cellIndex);
      if (patch.metadata === undefined) {
        const lastLine = Math.max(0, cell.document.lineCount - 1);
        const lastChar = cell.document.lineAt(lastLine).range.end.character;
        const fullRange = new vscode.Range(0, 0, lastLine, lastChar);
        edit.replace(cell.document.uri, fullRange, patch.newSource);
      } else {
        const data = new vscode.NotebookCellData(
          cell.kind,
          patch.newSource,
          cell.document.languageId,
        );
        data.metadata = { ...patch.metadata };
        data.outputs = [...cell.outputs];
        if (cell.executionSummary !== undefined) {
          data.executionSummary = cell.executionSummary;
        }
        edit.set(this.doc.uri, [
          vscode.NotebookEdit.replaceCells(
            new vscode.NotebookRange(patch.cellIndex, patch.cellIndex + 1),
            [data],
          ),
        ]);
      }
    }

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new Error(
        `NotebookBridge.applyPatch: WorkspaceEdit was rejected for cell ${String(patch.cellIndex)}`,
      );
    }
  }

  async clearOutputs(cellIndices: number[]): Promise<void> {
    const edits = uniqueCellIndices(cellIndices).map((cellIndex) =>
      this.buildCellReplacement(cellIndex, [], undefined),
    );
    if (edits.length === 0) {
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.set(this.doc.uri, edits);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new Error("NotebookBridge.clearOutputs: WorkspaceEdit was rejected");
    }
  }

  async replaceOutputs(
    cellIndex: number,
    outputs: NbOutput[],
    status: string,
    durationMs: number,
  ): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.set(this.doc.uri, [
      this.buildCellReplacement(cellIndex, outputs, executionSummary(status, durationMs)),
    ]);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new Error(
        `NotebookBridge.replaceOutputs: WorkspaceEdit was rejected for cell ${String(cellIndex)}`,
      );
    }
  }

  private buildCellReplacement(
    cellIndex: number,
    outputs: NbOutput[],
    summary: vscode.NotebookCellExecutionSummary | undefined,
  ): vscode.NotebookEdit {
    if (cellIndex < 0 || cellIndex >= this.doc.cellCount) {
      throw new Error(
        `NotebookBridge.buildCellReplacement: cellIndex ${String(cellIndex)} out of range`,
      );
    }
    const cell = this.doc.cellAt(cellIndex);
    const data = new vscode.NotebookCellData(
      cell.kind,
      cell.document.getText(),
      cell.document.languageId,
    );
    data.metadata = { ...cell.metadata };
    data.outputs = outputs.map(toVsCodeOutput);
    if (summary !== undefined) {
      data.executionSummary = summary;
    }
    return vscode.NotebookEdit.replaceCells(new vscode.NotebookRange(cellIndex, cellIndex + 1), [
      data,
    ]);
  }
}

function cellKind(kind: vscode.NotebookCellKind): NotebookCell["cellType"] {
  switch (kind) {
    case vscode.NotebookCellKind.Code:
      return "code";
    case vscode.NotebookCellKind.Markup:
      return "markdown";
    default:
      return "raw";
  }
}

function toVsCodeCellKind(kind: NotebookCell["cellType"]): vscode.NotebookCellKind {
  return kind === "markdown" ? vscode.NotebookCellKind.Markup : vscode.NotebookCellKind.Code;
}

function defaultLanguageId(kind: NotebookCell["cellType"]): string {
  if (kind === "markdown") {
    return "markdown";
  }
  if (kind === "raw") {
    return "plaintext";
  }
  return "python";
}

function uniqueCellIndices(cellIndices: number[]): number[] {
  return Array.from(new Set(cellIndices)).sort((left, right) => left - right);
}

function executionSummary(
  status: string,
  durationMs: number,
): vscode.NotebookCellExecutionSummary | undefined {
  if (status === "skipped") {
    return undefined;
  }
  const endTime = Date.now();
  const safeDurationMs = Math.max(0, Math.round(durationMs));
  return {
    success: status === "ok",
    timing: {
      startTime: endTime - safeDurationMs,
      endTime,
    },
  };
}

function toVsCodeOutput(output: NbOutput): vscode.NotebookCellOutput {
  switch (output.output_type) {
    case "stream":
      return new vscode.NotebookCellOutput([
        output.name === "stderr"
          ? vscode.NotebookCellOutputItem.stderr(output.text)
          : vscode.NotebookCellOutputItem.stdout(output.text),
      ]);
    case "display_data":
    case "execute_result":
      return new vscode.NotebookCellOutput(
        Object.entries(output.data).map(([mime, value]) => toVsCodeOutputItem(mime, value)),
        output.metadata,
      );
    case "error": {
      const error = new Error(output.evalue);
      error.name = output.ename;
      if (output.traceback.length > 0) {
        error.stack = output.traceback.join("\n");
      }
      return new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(error)]);
    }
  }
}

function toVsCodeOutputItem(mime: string, value: string): vscode.NotebookCellOutputItem {
  if (mime === "application/json" || mime.endsWith("+json")) {
    try {
      return vscode.NotebookCellOutputItem.json(JSON.parse(value), mime);
    } catch {
      return vscode.NotebookCellOutputItem.text(value, mime);
    }
  }
  return vscode.NotebookCellOutputItem.text(value, mime);
}
