/**
 * Client for the per-user notebook persistence API (#60). Same-origin fetch
 * with the session cookie; server scopes everything to the signed-in user.
 */

import { LocalizableError } from "@/lib/errors";
import type { WorkspaceFile } from "@/lib/workspaceZip";

export interface NotebookSummary {
  id: string;
  name: string;
  updatedAt: number;
}

export interface NotebookRecord extends NotebookSummary {
  content: string;
}

/** Serialized workspace stored in a notebook row's `content`. */
export interface WorkspacePosition {
  x: number;
  y: number;
}

export interface WorkspaceLayoutState {
  groupPositions?: Record<string, WorkspacePosition>;
}

export interface WorkspaceUiState {
  notebookRatio?: number;
  mainRatio?: number;
  filesCollapsed?: boolean;
  cellsCollapsed?: boolean;
  inspectorCollapsed?: boolean;
  sidebarCollapsed?: boolean;
  sidebarWidth?: number;
  showMinimap?: boolean;
}

export interface ParsedWorkspace {
  files: WorkspaceFile[];
  activeFileName?: string;
  layout?: WorkspaceLayoutState;
  ui?: WorkspaceUiState;
}

export interface SavedWorkspaceV1 {
  version: 1;
  files: WorkspaceFile[];
}

export interface SavedWorkspaceV2 extends ParsedWorkspace {
  version: 2;
}

export type SavedWorkspace = SavedWorkspaceV1 | SavedWorkspaceV2;
type WorkspaceUiNumberKey = "notebookRatio" | "mainRatio" | "sidebarWidth";
type WorkspaceUiBooleanKey =
  | "filesCollapsed"
  | "cellsCollapsed"
  | "inspectorCollapsed"
  | "sidebarCollapsed"
  | "showMinimap";

export function serializeWorkspace(workspace: ParsedWorkspace | WorkspaceFile[]): string {
  const normalized: ParsedWorkspace = Array.isArray(workspace) ? { files: workspace } : workspace;
  return JSON.stringify({ version: 2, ...normalized } satisfies SavedWorkspaceV2);
}

export function parseWorkspace(content: string): ParsedWorkspace {
  const parsed = JSON.parse(content) as unknown;
  if (!isRecord(parsed)) {
    throw new LocalizableError("app.errors.notWorkspace");
  }
  const workspace: {
    activeFileName?: unknown;
    files?: unknown;
    layout?: unknown;
    ui?: unknown;
  } = parsed;
  const rawFiles = workspace.files;
  if (!Array.isArray(rawFiles)) {
    throw new LocalizableError("app.errors.notWorkspace");
  }
  const files = rawFiles.filter(isWorkspaceFile);
  if (files.length === 0) {
    throw new LocalizableError("app.errors.workspaceNoNotebooks");
  }
  const activeFileName =
    typeof workspace.activeFileName === "string" ? workspace.activeFileName : undefined;
  const layout = parseWorkspaceLayout(workspace.layout);
  const ui = parseWorkspaceUi(workspace.ui);
  return {
    files,
    ...(activeFileName === undefined ? {} : { activeFileName }),
    ...(layout === undefined ? {} : { layout }),
    ...(ui === undefined ? {} : { ui }),
  };
}

function parseWorkspaceLayout(value: unknown): WorkspaceLayoutState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const layout: { groupPositions?: unknown } = value;
  const groupPositions = parseWorkspacePositions(layout.groupPositions);
  return groupPositions === undefined ? undefined : { groupPositions };
}

function parseWorkspacePositions(value: unknown): Record<string, WorkspacePosition> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const positions: Record<string, WorkspacePosition> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw)) {
      continue;
    }
    const point: { x?: unknown; y?: unknown } = raw;
    const x = point.x;
    const y = point.y;
    if (
      typeof x === "number" &&
      Number.isFinite(x) &&
      typeof y === "number" &&
      Number.isFinite(y)
    ) {
      positions[key] = { x, y };
    }
  }
  return Object.keys(positions).length === 0 ? undefined : positions;
}

function parseWorkspaceUi(value: unknown): WorkspaceUiState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const ui: WorkspaceUiState = {};
  copyFiniteNumber(value, ui, "notebookRatio");
  copyFiniteNumber(value, ui, "mainRatio");
  copyFiniteNumber(value, ui, "sidebarWidth");
  copyBoolean(value, ui, "filesCollapsed");
  copyBoolean(value, ui, "cellsCollapsed");
  copyBoolean(value, ui, "inspectorCollapsed");
  copyBoolean(value, ui, "sidebarCollapsed");
  copyBoolean(value, ui, "showMinimap");
  return Object.keys(ui).length === 0 ? undefined : ui;
}

function copyFiniteNumber(
  source: Record<string, unknown>,
  target: WorkspaceUiState,
  key: WorkspaceUiNumberKey,
): void {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    target[key] = value;
  }
}

function copyBoolean(
  source: Record<string, unknown>,
  target: WorkspaceUiState,
  key: WorkspaceUiBooleanKey,
): void {
  const value = source[key];
  if (typeof value === "boolean") {
    target[key] = value;
  }
}

function isWorkspaceFile(value: unknown): value is WorkspaceFile {
  if (!isRecord(value)) {
    return false;
  }
  const file: { json?: unknown; name?: unknown } = value;
  return typeof file.name === "string" && file.name.trim() !== "" && typeof file.json === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`/api/notebooks${path}`, { credentials: "include", ...init });
  if (!res.ok) {
    throw new LocalizableError("app.errors.cloudRequestFailed", { status: res.status });
  }
  return res;
}

const jsonHeaders = { "content-type": "application/json" };

export async function listNotebooks(): Promise<NotebookSummary[]> {
  return (await request("")).json();
}

export async function getNotebook(id: string): Promise<NotebookRecord> {
  return (await request(`/${encodeURIComponent(id)}`)).json();
}

export async function createNotebook(name: string, content: string): Promise<NotebookSummary> {
  return (
    await request("", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ name, content }),
    })
  ).json();
}

export async function updateNotebook(
  id: string,
  patch: { name?: string; content?: string },
): Promise<NotebookSummary> {
  return (
    await request(`/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(patch),
    })
  ).json();
}

export async function deleteNotebook(id: string): Promise<void> {
  await request(`/${encodeURIComponent(id)}`, { method: "DELETE" });
}
