/**
 * Shared statistics + machine-context helpers for the TypeScript benchmarks.
 *
 * Kept dependency-free (only Node built-ins) so the bench can run in the
 * graph-canvas package context without pulling extra packages.
 */

import { execSync } from "node:child_process";
import os from "node:os";

/** Median of a numeric sample (linear interpolation for even-length input). */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("median() requires at least one value");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] as number;
  }
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function min(values: readonly number[]): number {
  return values.reduce((a, b) => (b < a ? b : a), values[0] as number);
}

export function max(values: readonly number[]): number {
  return values.reduce((a, b) => (b > a ? b : a), values[0] as number);
}

/** Round to a fixed number of decimals, returned as a number (not a string). */
export function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export interface MachineContext {
  os: string;
  osRelease: string;
  arch: string;
  cpuModel: string;
  logicalCores: number;
  ramGiB: number;
  nodeVersion: string;
  v8Version: string;
  gitCommit: string;
  capturedAtIso: string;
  hostname: string;
}

function safeGitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Snapshot the machine so a reviewer can judge comparability of numbers. */
export function captureMachineContext(): MachineContext {
  const cpus = os.cpus();
  return {
    os: `${os.type()} ${os.platform()}`,
    osRelease: os.release(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model.trim() ?? "unknown",
    logicalCores: cpus.length,
    ramGiB: round(os.totalmem() / 1024 ** 3, 2),
    nodeVersion: process.version,
    v8Version: process.versions.v8 ?? "unknown",
    gitCommit: safeGitCommit(),
    capturedAtIso: new Date().toISOString(),
    hostname: os.hostname(),
  };
}

/** yyyy-mm-dd in local time, for result filenames. */
export function isoDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Sanitise a hostname so it is safe to embed in a filename. */
export function safeHost(host = os.hostname()): string {
  return host.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}
