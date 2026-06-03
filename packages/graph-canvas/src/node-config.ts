import type { NodeTag } from "./types";

export interface NodePortDef {
  name: string;
  type: string;
  required: boolean;
}

export interface NodeConfigOptionDef {
  value: string;
  label: string;
}

export type NodeConfigFieldKind = "text" | "textarea" | "select";
export type NodeGenerationMode = "template" | "llm";

export interface NodeConfigFieldDef {
  key: string;
  label: string;
  kind: NodeConfigFieldKind;
  description: string;
  placeholder: string;
  required: boolean;
  defaultValue: string;
  options: NodeConfigOptionDef[];
}

export interface NodeManifestDef {
  id: string;
  name: string;
  tag: NodeTag;
  version: string;
  description: string;
  inputs: NodePortDef[];
  outputs: NodePortDef[];
  template: string;
  generationMode: NodeGenerationMode;
  configFields: NodeConfigFieldDef[];
}

export interface NotebookflowNodeMetadata {
  manifestId?: string;
  manifestVersion?: string;
  config?: Record<string, string>;
  lastGeneratedAt?: string;
  lastGenerationBackend?: string;
}

export interface NodeSynthesisRequest {
  manifestId: string;
  nodeName: string;
  inputs: string[];
  outputs: string[];
  config: Record<string, string>;
  currentSource: string;
}

export interface NodeSynthesisResponse {
  source: string;
  backend: string;
  warnings: string[];
}

export function defaultConfigForManifest(manifest: NodeManifestDef): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of manifest.configFields) {
    result[field.key] = field.defaultValue;
  }
  return result;
}

export function sanitizeConfigForManifest(
  manifest: NodeManifestDef,
  values: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of manifest.configFields) {
    result[field.key] = values[field.key] ?? field.defaultValue;
  }
  return result;
}

export function resolveNodeConfig(
  manifest: NodeManifestDef,
  metadata: Record<string, unknown> | undefined,
): Record<string, string> {
  const storedConfig = readNotebookflowMetadata(metadata).config ?? {};
  return {
    ...defaultConfigForManifest(manifest),
    ...storedConfig,
  };
}

export function configValuesEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] ?? "") !== (right[key] ?? "")) {
      return false;
    }
  }
  return true;
}

export function hasMissingRequiredConfig(
  manifest: NodeManifestDef,
  values: Record<string, string>,
): boolean {
  return manifest.configFields.some((field) => field.required && (values[field.key] ?? "").trim() === "");
}

export function readNotebookflowMetadata(
  metadata: Record<string, unknown> | undefined,
): NotebookflowNodeMetadata {
  const notebookflow = asRecord(metadata?.["notebookflow"]);
  if (notebookflow === null) {
    return {};
  }

  const config = asStringRecord(notebookflow["config"]);
  const result: NotebookflowNodeMetadata = {};

  if (typeof notebookflow["manifestId"] === "string") {
    result.manifestId = notebookflow["manifestId"];
  }
  if (typeof notebookflow["manifestVersion"] === "string") {
    result.manifestVersion = notebookflow["manifestVersion"];
  }
  if (Object.keys(config).length > 0) {
    result.config = config;
  }
  if (typeof notebookflow["lastGeneratedAt"] === "string") {
    result.lastGeneratedAt = notebookflow["lastGeneratedAt"];
  }
  if (typeof notebookflow["lastGenerationBackend"] === "string") {
    result.lastGenerationBackend = notebookflow["lastGenerationBackend"];
  }

  return result;
}

export function writeNotebookflowMetadata(
  metadata: Record<string, unknown> | undefined,
  patch: NotebookflowNodeMetadata,
): Record<string, unknown> {
  const existing = readNotebookflowMetadata(metadata);
  const merged: NotebookflowNodeMetadata = {
    ...existing,
    ...patch,
    ...(patch.config === undefined ? {} : { config: { ...patch.config } }),
  };

  const notebookflow: Record<string, unknown> = {};
  if (merged.manifestId !== undefined) {
    notebookflow["manifestId"] = merged.manifestId;
  }
  if (merged.manifestVersion !== undefined) {
    notebookflow["manifestVersion"] = merged.manifestVersion;
  }
  if (merged.config !== undefined) {
    notebookflow["config"] = { ...merged.config };
  }
  if (merged.lastGeneratedAt !== undefined) {
    notebookflow["lastGeneratedAt"] = merged.lastGeneratedAt;
  }
  if (merged.lastGenerationBackend !== undefined) {
    notebookflow["lastGenerationBackend"] = merged.lastGenerationBackend;
  }

  return {
    ...(metadata ?? {}),
    notebookflow,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (record === null) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string") {
      result[key] = entry;
    }
  }
  return result;
}