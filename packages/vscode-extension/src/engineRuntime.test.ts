import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ENGINE_BOOTSTRAP,
  engineLaunchArgs,
  isCompatibleEngineVersion,
  isSupportedPythonVersion,
  managedEngineDirectory,
  parseEngineVersion,
  parsePythonVersion,
  pythonCandidates,
  venvPythonPath,
} from "./engineRuntime.js";

describe("engine runtime", () => {
  it("accepts only the Python versions published by notebookflow-app", () => {
    expect(isSupportedPythonVersion(parsePythonVersion("3.11.9"))).toBe(true);
    expect(isSupportedPythonVersion(parsePythonVersion("Python 3.13.1"))).toBe(true);
    expect(isSupportedPythonVersion(parsePythonVersion("3.10.14"))).toBe(false);
    expect(isSupportedPythonVersion(parsePythonVersion("3.14.0"))).toBe(false);
    expect(parsePythonVersion("not Python")).toBeNull();
  });

  it("keeps engine compatibility within the 0.1 release line", () => {
    expect(parseEngineVersion("0.1.0")).toEqual({ major: 0, minor: 1, patch: 0 });
    expect(isCompatibleEngineVersion("0.1.9")).toBe(true);
    expect(isCompatibleEngineVersion("0.2.0")).toBe(false);
    expect(isCompatibleEngineVersion("garbage")).toBe(false);
  });

  it("honors an explicitly configured Python executable", () => {
    expect(pythonCandidates("win32", " C:\\Python313\\python.exe ")).toEqual([
      {
        command: "C:\\Python313\\python.exe",
        prefixArgs: [],
        label: "C:\\Python313\\python.exe",
      },
    ]);
  });

  it("uses versioned Windows launcher candidates", () => {
    const candidates = pythonCandidates("win32");
    expect(candidates.slice(0, 3).map((candidate) => candidate.prefixArgs[0])).toEqual([
      "-3.13",
      "-3.12",
      "-3.11",
    ]);
  });

  it("builds platform-specific managed paths and launch arguments", () => {
    const storage = path.join("tmp", "notebookflow");
    const managed = managedEngineDirectory(storage);
    expect(managed).toBe(path.join(storage, "engine-0.1"));
    expect(venvPythonPath(managed, "win32")).toBe(
      path.join(storage, "engine-0.1", "Scripts", "python.exe"),
    );
    expect(venvPythonPath(managed, "linux")).toBe(
      path.join(storage, "engine-0.1", "bin", "python"),
    );
    expect(engineLaunchArgs({ command: "py", prefixArgs: ["-3.12"], label: "Python" })).toEqual([
      "-3.12",
      "-c",
      ENGINE_BOOTSTRAP,
    ]);
  });
});
