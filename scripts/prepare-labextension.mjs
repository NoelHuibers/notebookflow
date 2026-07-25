#!/usr/bin/env node
/**
 * Add Python-package metadata to the prebuilt JupyterLab extension.
 *
 * JupyterLab's builder writes package.json + static assets. The Extension
 * Manager also expects install.json so it can identify the owning PyPI
 * distribution and show correct uninstall instructions.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const extensionRoot = path.join(root, "packages", "jupyterlab-extension");
const outputRoot = path.join(root, "engine", "notebookflow", "labextension");

const sourcePackage = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"));
const builtPackagePath = path.join(outputRoot, "package.json");
if (!fs.existsSync(builtPackagePath)) {
  throw new Error(
    `JupyterLab did not create ${builtPackagePath}; run the labextension build first.`,
  );
}
const builtPackage = JSON.parse(fs.readFileSync(builtPackagePath, "utf8"));

const pyproject = fs.readFileSync(path.join(root, "engine", "pyproject.toml"), "utf8");
const projectStart = pyproject.indexOf("[project]");
const projectEnd = pyproject.indexOf("\n[", projectStart + 1);
const projectBlock =
  projectStart === -1
    ? ""
    : pyproject.slice(projectStart, projectEnd === -1 ? undefined : projectEnd);
const pythonVersion = projectBlock?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (!pythonVersion) {
  throw new Error("Could not read [project].version from engine/pyproject.toml.");
}

for (const [label, version] of [
  ["source extension", sourcePackage.version],
  ["built extension", builtPackage.version],
]) {
  if (version !== pythonVersion) {
    throw new Error(
      `${label} version ${String(version)} does not match Python package version ${pythonVersion}.`,
    );
  }
}

fs.copyFileSync(path.join(extensionRoot, "install.json"), path.join(outputRoot, "install.json"));

const schemaSource = path.join(extensionRoot, "schema");
const schemaOutput = path.join(outputRoot, "schemas", sourcePackage.name);
fs.mkdirSync(schemaOutput, { recursive: true });
fs.cpSync(schemaSource, schemaOutput, { recursive: true });

console.log(
  `prepare-labextension: prepared ${sourcePackage.name}@${pythonVersion} for notebookflow-app`,
);
