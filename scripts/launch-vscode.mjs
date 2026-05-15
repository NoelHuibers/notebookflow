#!/usr/bin/env node
/**
 * launch-vscode.mjs — open the NotebookFlow VS Code extension dev host.
 *
 * Resolves absolute paths so it works from any cwd (pnpm scripts run from
 * the package root, but Windows / macOS / Linux differ on how relative
 * paths are quoted to `code`). Spawns the `code` CLI with the extension's
 * --extensionDevelopmentPath set and the example notebook as the file to
 * open inside the dev host.
 *
 * Requires the `code` CLI on PATH. On macOS that's installed via
 * "Shell Command: Install 'code' command in PATH" from the command
 * palette; on Windows it's added automatically by the standard installer.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const extensionPath = path.join(repoRoot, "packages", "vscode-extension");
const examplePath = path.join(repoRoot, "examples", "demo.ipynb");

const child = spawn(
  "code",
  ["--extensionDevelopmentPath", extensionPath, "--new-window", examplePath],
  { stdio: "inherit", shell: true },
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

child.on("error", (err) => {
  console.error(
    `launch-vscode: failed to invoke \`code\` (${err.message}). ` +
      "Install the 'code' CLI shim from VS Code's command palette and try again.",
  );
  process.exit(1);
});
