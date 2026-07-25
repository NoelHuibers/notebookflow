/** Owns the released NotebookFlow Python engine for one VS Code window. */

import { type ChildProcess, type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";

import * as vscode from "vscode";

import {
  engineLaunchArgs,
  isCompatibleEngineVersion,
  isSupportedPythonVersion,
  MANAGED_ENGINE_DISTRIBUTION,
  MANAGED_ENGINE_VERSION,
  managedEngineDirectory,
  type PythonCommand,
  parsePythonVersion,
  pythonCandidates,
  venvPythonPath,
  withPythonArgs,
} from "./engineRuntime.js";

const HOST = "127.0.0.1";
const HEALTH_POLL_INTERVAL_MS = 400;
const HEALTH_TIMEOUT_MS = 180_000;
const SETUP_TIMEOUT_MS = 30 * 60_000;
const PYTHON_VERSION_CODE = "import platform; print(platform.python_version())";
const ENGINE_VERSION_CODE = "import importlib.metadata as m; print(m.version('notebookflow-app'))";

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error: Error | null;
}

interface EngineLaunch {
  command: string;
  args: string[];
  description: string;
  cwd?: string;
}

interface PythonInspection {
  command: PythonCommand;
  version: string;
}

export class EngineProcess implements vscode.Disposable {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private url: string | null = null;
  private startPromise: Promise<string> | null = null;
  private readonly output = vscode.window.createOutputChannel("NotebookFlow Engine");
  private readonly storageRoot: string;
  private disposed = false;

  constructor(storageRoot: string) {
    this.storageRoot = storageRoot;
  }

  get baseUrl(): string | null {
    return this.url;
  }

  async start(): Promise<string> {
    if (this.disposed) {
      throw new Error("the NotebookFlow engine has already been disposed");
    }
    if (this.url !== null) {
      return this.url;
    }
    if (this.startPromise !== null) {
      return this.startPromise;
    }
    this.startPromise = this.startEngine().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async startEngine(): Promise<string> {
    const launch = await this.resolveEngine();
    const port = await findAvailablePort();
    const url = `http://${HOST}:${String(port)}`;
    this.output.appendLine(`[engine] starting ${launch.description} at ${url}`);

    const options = {
      shell: false,
      env: {
        ...process.env,
        HOST,
        PORT: String(port),
        PYTHONUNBUFFERED: "1",
      },
      ...(launch.cwd === undefined ? {} : { cwd: launch.cwd }),
    };
    const proc = spawn(launch.command, launch.args, options);
    this.proc = proc;
    let spawnErrorMessage = "";

    proc.stdout.on("data", (data: Buffer) => {
      this.output.append(data.toString("utf8"));
    });
    proc.stderr.on("data", (data: Buffer) => {
      this.output.append(data.toString("utf8"));
    });
    proc.on("error", (error) => {
      spawnErrorMessage = error.message;
      this.output.appendLine(`[engine] could not start: ${error.message}`);
    });
    proc.on("exit", (code) => {
      this.output.appendLine(`[engine] exited with code ${String(code)}`);
      if (this.proc === proc) {
        this.proc = null;
        this.url = null;
      }
    });

    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (spawnErrorMessage !== "") {
        return this.failStart(proc, `could not launch the local engine: ${spawnErrorMessage}`);
      }
      if (proc.exitCode !== null) {
        return this.failStart(
          proc,
          `the local engine exited before it became ready (code ${String(proc.exitCode)})`,
        );
      }
      if (await isHealthy(url)) {
        this.url = url;
        this.output.appendLine(`[engine] healthy at ${url}`);
        return url;
      }
      await sleep(HEALTH_POLL_INTERVAL_MS);
    }

    return this.failStart(proc, "the local engine did not become ready within 180 seconds");
  }

  private failStart(proc: ChildProcessWithoutNullStreams, message: string): never {
    terminateProcess(proc);
    if (this.proc === proc) {
      this.proc = null;
    }
    this.output.appendLine(`[engine] ${message}`);
    this.output.show(true);
    throw new Error(`${message}. See Output > NotebookFlow Engine for details.`);
  }

  private async resolveEngine(): Promise<EngineLaunch> {
    const config = vscode.workspace.getConfiguration("notebookflow");
    const developmentPath = config.get<string>("enginePath", "").trim();
    if (developmentPath !== "") {
      const stat = await fs.stat(developmentPath).catch(() => null);
      if (stat === null || !stat.isDirectory()) {
        throw new Error(
          `notebookflow.enginePath is not a directory: ${developmentPath}. ` +
            "Clear that development setting to use the managed engine.",
        );
      }
      return {
        command: "uv",
        args: ["run", "notebookflow"],
        cwd: developmentPath,
        description: `development engine in ${developmentPath}`,
      };
    }

    const managedDirectory = managedEngineDirectory(this.storageRoot);
    const managedPython: PythonCommand = {
      command: venvPythonPath(managedDirectory, process.platform),
      prefixArgs: [],
      label: "NotebookFlow managed Python",
    };
    const managedInspection = await this.inspectPython(managedPython);
    if (managedInspection !== null) {
      const installedVersion = await this.installedEngineVersion(managedPython);
      if (installedVersion !== null && isCompatibleEngineVersion(installedVersion)) {
        this.output.appendLine(`[engine] using managed engine ${installedVersion}`);
        return pythonEngineLaunch(managedPython, `managed engine ${installedVersion}`);
      }
    }

    const configuredPython = config.get<string>("pythonPath", "");
    const systemPython = await this.findSupportedPython(configuredPython);
    if (systemPython === null && managedInspection === null) {
      await this.reportMissingPython(configuredPython);
      throw new Error(
        "Python 3.11-3.13 is required. Install it, then reopen the NotebookFlow canvas.",
      );
    }

    if (systemPython !== null) {
      const installedVersion = await this.installedEngineVersion(systemPython.command);
      if (installedVersion !== null && isCompatibleEngineVersion(installedVersion)) {
        this.output.appendLine(`[engine] using ${installedVersion} from ${systemPython.version}`);
        return pythonEngineLaunch(
          systemPython.command,
          `system engine ${installedVersion} (${systemPython.version})`,
        );
      }
    }

    const choice = await vscode.window.showInformationMessage(
      "NotebookFlow needs its local execution engine.",
      {
        modal: true,
        detail:
          `Install ${MANAGED_ENGINE_DISTRIBUTION} ${MANAGED_ENGINE_VERSION} into private ` +
          "extension storage? Your notebooks and pipeline runs stay on this machine.",
      },
      "Install Local Engine",
    );
    if (choice !== "Install Local Engine") {
      throw new Error("local engine installation was cancelled");
    }

    const installer = managedInspection?.command ?? systemPython?.command;
    if (installer === undefined) {
      throw new Error("a compatible Python installation is required to install the local engine");
    }
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "NotebookFlow: installing the local engine",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "The first installation can take several minutes." });
        return this.installManagedEngine(installer, managedDirectory, managedInspection !== null);
      },
    );
  }

  private async findSupportedPython(configuredPath: string): Promise<PythonInspection | null> {
    for (const candidate of pythonCandidates(process.platform, configuredPath)) {
      const inspection = await this.inspectPython(candidate);
      if (inspection !== null) {
        return inspection;
      }
    }
    return null;
  }

  private async inspectPython(command: PythonCommand): Promise<PythonInspection | null> {
    const result = await runCommand(
      command.command,
      withPythonArgs(command, ["-c", PYTHON_VERSION_CODE]),
      15_000,
    );
    if (result.code !== 0) {
      return null;
    }
    const parsed = parsePythonVersion(result.stdout);
    if (!isSupportedPythonVersion(parsed)) {
      return null;
    }
    return { command, version: result.stdout.trim() };
  }

  private async installedEngineVersion(command: PythonCommand): Promise<string | null> {
    const result = await runCommand(
      command.command,
      withPythonArgs(command, ["-c", ENGINE_VERSION_CODE]),
      15_000,
    );
    return result.code === 0 ? result.stdout.trim() : null;
  }

  private async installManagedEngine(
    installer: PythonCommand,
    managedDirectory: string,
    reuseManagedEnvironment: boolean,
  ): Promise<EngineLaunch> {
    await fs.mkdir(this.storageRoot, { recursive: true });
    if (!reuseManagedEnvironment) {
      const createResult = await this.runLogged(
        installer.command,
        withPythonArgs(installer, ["-m", "venv", "--clear", managedDirectory]),
      );
      if (createResult.code !== 0) {
        this.output.show(true);
        throw new Error(
          "could not create the managed Python environment. " +
            "See Output > NotebookFlow Engine for details.",
        );
      }
    }

    const managedPython: PythonCommand = {
      command: venvPythonPath(managedDirectory, process.platform),
      prefixArgs: [],
      label: "NotebookFlow managed Python",
    };
    const installResult = await this.runLogged(managedPython.command, [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--upgrade",
      `${MANAGED_ENGINE_DISTRIBUTION}==${MANAGED_ENGINE_VERSION}`,
    ]);
    if (installResult.code !== 0) {
      this.output.show(true);
      throw new Error(
        "could not install the managed local engine. " +
          "Check your network connection and Output > NotebookFlow Engine.",
      );
    }

    const installedVersion = await this.installedEngineVersion(managedPython);
    if (installedVersion !== MANAGED_ENGINE_VERSION) {
      this.output.show(true);
      throw new Error(
        `expected engine ${MANAGED_ENGINE_VERSION}, but found ${installedVersion ?? "nothing"}`,
      );
    }
    this.output.appendLine(`[engine] installed managed engine ${installedVersion}`);
    return pythonEngineLaunch(managedPython, `managed engine ${installedVersion}`);
  }

  private runLogged(command: string, args: string[]): Promise<CommandResult> {
    this.output.appendLine(`[setup] ${formatCommand(command, args)}`);
    return runCommand(command, args, SETUP_TIMEOUT_MS, (text) => this.output.append(text));
  }

  private async reportMissingPython(configuredPath: string): Promise<void> {
    const detail =
      configuredPath.trim() === ""
        ? "NotebookFlow could not find Python 3.11, 3.12, or 3.13 on PATH."
        : `NotebookFlow could not run a supported Python at ${configuredPath.trim()}.`;
    const choice = await vscode.window.showErrorMessage(
      `${detail} Install a supported Python, or configure notebookflow.pythonPath.`,
      "Download Python",
      "Open Settings",
    );
    if (choice === "Download Python") {
      await vscode.env.openExternal(vscode.Uri.parse("https://www.python.org/downloads/"));
    } else if (choice === "Open Settings") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "notebookflow.pythonPath",
      );
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.proc !== null) {
      terminateProcess(this.proc);
      this.proc = null;
    }
    this.url = null;
    this.output.dispose();
  }
}

function pythonEngineLaunch(command: PythonCommand, description: string): EngineLaunch {
  return {
    command: command.command,
    args: engineLaunchArgs(command),
    description,
  };
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map((part) => (part.includes(" ") ? JSON.stringify(part) : part))
    .join(" ");
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  onOutput?: (text: string) => void,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const proc = spawn(command, args, { shell: false, env: process.env });
    const timer = setTimeout(() => {
      terminateProcess(proc);
      finish({
        code: null,
        stdout,
        stderr,
        error: new Error(`command timed out after ${String(timeoutMs)} ms`),
      });
    }, timeoutMs);

    const finish = (result: CommandResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    proc.stdout.on("data", (data: Buffer) => {
      const text = data.toString("utf8");
      stdout += text;
      onOutput?.(text);
    });
    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString("utf8");
      stderr += text;
      onOutput?.(text);
    });
    proc.on("error", (error) => {
      finish({ code: null, stdout, stderr, error });
    });
    proc.on("close", (code) => {
      finish({ code, stdout, stderr, error: null });
    });
  });
}

/** `python.exe` and `uv.exe` can leave their real child alive on Windows. */
function terminateProcess(proc: ChildProcess): void {
  const pid = proc.pid;
  if (process.platform !== "win32" || pid === undefined) {
    proc.kill();
    return;
  }
  const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  killer.on("error", () => {
    proc.kill();
  });
  killer.on("close", (code) => {
    if (code !== 0) {
      proc.kill();
    }
  });
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("could not allocate a local port for the NotebookFlow engine"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error === undefined) {
          resolve(port);
        } else {
          reject(error);
        }
      });
    });
  });
}

async function isHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1_500) });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as { status?: unknown };
    return body.status === "ok";
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
