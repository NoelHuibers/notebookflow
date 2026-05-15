#!/usr/bin/env node
/**
 * install-labextension.mjs — copy the built labextension into the engine venv.
 *
 * JupyterLab discovers federated extensions from
 * ``<sys.prefix>/share/jupyter/labextensions/<name>/``. The official
 * ``jupyter labextension develop`` command wraps a ``pip install -e`` plus
 * a symlink into that dir, but it requires the source to be a Python
 * package — which our JS-only ``packages/jupyterlab-extension`` isn't.
 *
 * This script does the linkage directly: copy the webpack output produced
 * by ``pnpm --filter @notebookflow/jupyterlab-extension build:lab`` into
 * ``engine/.venv/share/jupyter/labextensions/@notebookflow/jupyterlab-extension/``.
 * Hard-copies (not symlinks) so it works on Windows without developer mode.
 * Re-run after every rebuild — that's why ``setup:jupyter`` and
 * ``start:jupyter`` both invoke it after ``build:lab``.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const src = path.join(root, "engine", "notebookflow", "labextension");
const dst = path.join(
  root,
  "engine",
  ".venv",
  "share",
  "jupyter",
  "labextensions",
  "@notebookflow",
  "jupyterlab-extension",
);

if (!fs.existsSync(src)) {
  console.error(
    `install-labextension: ${src} doesn't exist. ` +
      "Run `pnpm --filter @notebookflow/jupyterlab-extension build:lab` first.",
  );
  process.exit(1);
}

const venvRoot = path.join(root, "engine", ".venv");
if (!fs.existsSync(venvRoot)) {
  console.error(
    `install-labextension: ${venvRoot} doesn't exist. ` +
      "Run `pnpm setup:engine` (or `uv --project engine sync --all-extras`) first.",
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(dst), { recursive: true });
if (fs.existsSync(dst)) {
  fs.rmSync(dst, { recursive: true, force: true });
}
fs.cpSync(src, dst, { recursive: true });

console.log(`install-labextension: copied ${src} -> ${dst}`);
