import path from "node:path";

export const MANAGED_ENGINE_DISTRIBUTION = "notebookflow-app";
export const MANAGED_ENGINE_VERSION = "0.1.0";
export const ENGINE_BOOTSTRAP = "from notebookflow.server import main; main()";

export interface PythonCommand {
  command: string;
  prefixArgs: string[];
  label: string;
}

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

/** Python versions supported by the released engine package. */
export function isSupportedPythonVersion(version: ParsedVersion | null): boolean {
  return version !== null && version.major === 3 && version.minor >= 11 && version.minor <= 13;
}

export function parsePythonVersion(output: string): ParsedVersion | null {
  const match = /(?:^|\s)(\d+)\.(\d+)(?:\.(\d+))?/.exec(output.trim());
  if (match === null) {
    return null;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3] ?? "0");
  if (![major, minor, patch].every(Number.isInteger)) {
    return null;
  }
  return { major, minor, patch };
}

export function parseEngineVersion(version: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[.+-].*)?$/.exec(version.trim());
  if (match === null) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/** Extension 0.1.x and engine 0.1.x share one protocol compatibility line. */
export function isCompatibleEngineVersion(version: string): boolean {
  const parsed = parseEngineVersion(version);
  return parsed !== null && parsed.major === 0 && parsed.minor === 1;
}

export function pythonCandidates(platform: NodeJS.Platform, configuredPath = ""): PythonCommand[] {
  const configured = configuredPath.trim();
  if (configured !== "") {
    return [{ command: configured, prefixArgs: [], label: configured }];
  }

  if (platform === "win32") {
    return [
      { command: "py", prefixArgs: ["-3.13"], label: "Python 3.13 (py launcher)" },
      { command: "py", prefixArgs: ["-3.12"], label: "Python 3.12 (py launcher)" },
      { command: "py", prefixArgs: ["-3.11"], label: "Python 3.11 (py launcher)" },
      { command: "python", prefixArgs: [], label: "python" },
      { command: "python3", prefixArgs: [], label: "python3" },
    ];
  }

  return [
    { command: "python3.13", prefixArgs: [], label: "python3.13" },
    { command: "python3.12", prefixArgs: [], label: "python3.12" },
    { command: "python3.11", prefixArgs: [], label: "python3.11" },
    { command: "python3", prefixArgs: [], label: "python3" },
    { command: "python", prefixArgs: [], label: "python" },
  ];
}

export function managedEngineDirectory(storageRoot: string): string {
  const parsed = parseEngineVersion(MANAGED_ENGINE_VERSION);
  const compatibilityLine =
    parsed === null ? MANAGED_ENGINE_VERSION : `${parsed.major}.${parsed.minor}`;
  return path.join(storageRoot, `engine-${compatibilityLine}`);
}

export function venvPythonPath(venvDirectory: string, platform: NodeJS.Platform): string {
  return platform === "win32"
    ? path.join(venvDirectory, "Scripts", "python.exe")
    : path.join(venvDirectory, "bin", "python");
}

export function withPythonArgs(command: PythonCommand, args: string[]): string[] {
  return [...command.prefixArgs, ...args];
}

export function engineLaunchArgs(command: PythonCommand): string[] {
  return withPythonArgs(command, ["-c", ENGINE_BOOTSTRAP]);
}
