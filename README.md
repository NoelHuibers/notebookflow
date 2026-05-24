# NotebookFlow

n8n-style workflow orchestration for computational notebooks. Visually wire together Jupyter notebooks and cell groups into pipelines, with AI assistance, a node library, and full bidirectional sync between the visual graph and the actual notebook cells.

## Quick start

### 1. Prerequisites

| Tool   | Version  | Notes                                                                |
|--------|----------|----------------------------------------------------------------------|
| Node   | `>=20`   | Required by every TS package.                                        |
| pnpm   | `>=10`   | Pinned via `packageManager` in [package.json](package.json) — `corepack enable` will pick it up. |
| Python | `>=3.11` | Required by the engine.                                              |
| uv     | latest   | Astral's package manager — used for the engine.                      |

### 2. One-time setup

```powershell
pnpm bootstrap
```

`pnpm bootstrap` chains everything you need on a clean checkout:

1. `pnpm install` — workspace deps.
2. `uv --project engine sync --all-extras` — engine venv with all dev extras.
3. `uv --project engine add --optional dev jupyterlab` — adds JupyterLab to the engine's dev group (no-op on repeat runs).
4. `pnpm --filter @notebookflow/jupyterlab-extension add -D @jupyterlab/builder` — adds the labextension webpack builder.
5. `pnpm --filter @notebookflow/jupyterlab-extension build:lab` — produces the labextension bundle into `engine/notebookflow/labextension/`.
6. `pnpm jupyter:install` — copies the labextension bundle into `engine/.venv/share/jupyter/labextensions/` so JupyterLab discovers it on launch.
7. `turbo run build` — builds every TS package (graph-canvas, web-app, vscode-extension, jupyterlab-extension).

It's idempotent — re-run after pulling.

> The script is named `bootstrap` (not `setup`) because `pnpm setup` is a built-in pnpm subcommand that installs pnpm globally — naming the script `setup` makes pnpm shadow it.

### 3. Pick an option

| Command              | What happens                                                                                              |
|----------------------|-----------------------------------------------------------------------------------------------------------|
| `pnpm start:web`     | Engine + Vite web app side-by-side via `concurrently`. Open the printed URL (`http://localhost:5173/`).   |
| `pnpm start:vscode`  | Builds the extension, then auto-launches a VS Code dev host with `examples/demo.ipynb` already open. Engine spawns automatically once you run the **NotebookFlow: Open Canvas** command. |
| `pnpm start:jupyter` | Builds the labextension bundle, then runs engine and JupyterLab side-by-side via `concurrently`. Lab opens with `examples/demo.ipynb`. |

Ctrl+C in any `start:*` command tears down all child processes via `concurrently`'s `--kill-others-on-fail`.

### What each one shows you

- **Web app** — SyncEngine + Canvas only (the web-app fixture is in-browser; no notebook write-back, no execution).
- **VS Code** — full loop: live notebook editing (`WorkspaceEdit` cell patches), rename round-trip, pipeline execution over WebSocket via the auto-spawned engine.
- **JupyterLab** — full loop: live notebook editing via JL's shared (CRDT) model, rename round-trip, pipeline execution over WebSocket to the parallel engine.

## Why NotebookFlow

Flowco (UIST 2025) proved that a dataflow graph is a better authoring model than a linear notebook — but it replaces the notebook entirely. NotebookFlow extends notebooks instead. The `.ipynb` file is always the source of truth. The graph is derived from it.

## Concepts

### Two-level data model

**Level 1 — Cell Group = Node.** A set of cells inside a notebook delimited by a `# @node` marker:

```python
# @node: Load CSV  [input]
import pandas as pd
df = pd.read_csv("data.csv")
```

The marker defines node name, tag (`input` / `transform` / `output` / `ai` / `io`), inputs, and outputs.

**Level 2 — Notebook = NodeGroup.** A full `.ipynb` file is a group of nodes. On the canvas it renders as a collapsible container. Collapsed = one rectangle. Expanded = shows internal cell-group nodes.

Connections can be drawn at either level:
- Notebook → Notebook (coarse, pipeline level)
- Node → Node across notebooks (fine-grained)

### Bidirectional sync — the core research contribution

The `.ipynb` file is always the source of truth. The graph is derived, never primary.

- **Cell → Graph:** parse `# @node` markers on file save → rebuild graph model automatically.
- **Graph → Cell:** rename a node or draw a wire → inject or update `# @node` markers in the notebook cells.
- **Conflict rule:** cell editor always wins on direct edit. Timestamp-based resolution otherwise.

This is what distinguishes NotebookFlow from Flowco: we extend notebooks rather than replacing them.

## Repo layout

```
notebookflow/
├── packages/
│   ├── graph-canvas/         # Shared React + React Flow component, SyncEngine, MarkerParser
│   ├── jupyterlab-extension/ # JupyterLab platform adapter (Lumino + ReactWidget)
│   ├── vscode-extension/     # VS Code platform adapter (host + Vite-bundled webview)
│   └── web-app/              # Standalone web app (Tailwind + shadcn shell)
├── engine/                   # Python backend (FastAPI + WebSocket, DAG/DataBus/Executor)
├── node-library-spec/        # Public extension protocol spec + reference package
├── examples/                 # Sample .ipynb files for the demos
├── biome.json
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

## Example notebook

`examples/demo.ipynb` is a self-contained four-node pipeline (Load Data → Filter → Summarize → Report) using inline pandas data — no external CSV required, so the `Run pipeline` button works out of the box. Use it as the reference for the marker grammar.

## Deploying

The web-app is a static React bundle, the engine is a Python FastAPI server with WebSocket. They deploy separately.

### Frontend on Vercel

1. **`packages/web-app/vercel.json`** is the canonical Vercel config for the monorepo. In the Vercel project settings, set **Root Directory** to `packages/web-app`. The included `installCommand` jumps to repo root for the workspace install (`cd ../.. && pnpm install --frozen-lockfile`).
2. Add an **Environment Variable** in Vercel: `VITE_NOTEBOOKFLOW_ENGINE_URL = wss://<your-engine>.fly.dev/ws`. The web-app bakes this in at build time; `Run pipeline` won't work without it pointing at a reachable engine.
3. Push → Vercel auto-builds → the static frontend goes live.

### Engine on Fly.io

The repo includes `Dockerfile`, `fly.toml`, and `.dockerignore` at the root. Fly's HTTP service tunnels WebSockets out of the box.

```powershell
# One-time
fly auth login
fly launch --no-deploy    # creates the app; keeps our fly.toml
fly deploy

# Verify
curl https://<app>.fly.dev/health    # -> {"status":"ok"}
curl https://<app>.fly.dev/nodes     # -> [...] (3 built-in manifests)
```

The container reads `PORT` (Fly sets this), binds `0.0.0.0`, and runs `uv run notebookflow`. `auto_stop_machines = "stop"` plus `min_machines_running = 0` keeps the engine within the free tier when idle.

After deploy, plug the URL into Vercel's env var (above), then redeploy the frontend.

### Other Python hosts

Same Dockerfile works on Railway, Render, Modal, DigitalOcean App Platform, or any container host. The engine just needs:
- The container to set `PORT` (most PaaS do).
- WebSocket support on the public route.
- ~512 MB RAM is plenty for the executor.

## Development

### Architecture layers

1. **Platform Adapters** — JupyterLab extension, VS Code extension, standalone web app. All share the same graph canvas component and talk to the core engine via WebSocket.
2. **View Layer** — Shared React + React Flow graph canvas, notebook cell view, sync engine ([MarkerParser.ts](packages/graph-canvas/src/sync/MarkerParser.ts), [SyncEngine.ts](packages/graph-canvas/src/sync/SyncEngine.ts)).
3. **Core Engine** — Python (FastAPI + WebSockets): DAG builder, executor, data bus (Parquet/JSON/file refs), trigger system.
4. **Node Library** — Built-in nodes tagged `input` / `transform` / `output` / `ai` / `io`. Third parties publish via the extension protocol.
5. **Extension Protocol** — Node packages declare a `node_manifest.json`. Installed via `pip install`, discovered via Python entry points.
6. **LLM Assistance** — Pipeline author (NL → pipeline), code synthesiser (per-node code), explainer (graph → prose).

### Platform communication

- **VS Code:** Extension auto-launches the engine as a child process on first canvas open, connects the webview to its WebSocket. Implemented.
- **JupyterLab:** Canvas connects to a manually-started engine over WebSocket today; a `jupyter-server-proxy` shim that auto-launches FastAPI is on the roadmap.
- **Standalone Web App:** Connects to a remotely hosted FastAPI instance, or a locally running one. (Currently exercises only the in-browser SyncEngine.)

The real engine always lives in FastAPI; each adapter is a thin host around it.

### Tech stack

**Frontend (TypeScript):** pnpm, Turborepo, React, React Flow, Tailwind v4, shadcn/ui (web-app shell), tsc, Vitest, Biome (lint + format).

**Backend (Python):** uv, Ruff, ty, pytest, FastAPI, WebSockets.

### Verify

Everything below should pass on a clean checkout:

```powershell
pnpm typecheck                  # tsc -b across all TS packages
pnpm check                      # biome lint + format check + import sort
pnpm --filter @notebookflow/graph-canvas test    # 40 sync-engine tests

cd engine
uv run ruff check .
uv run ty check
uv run pytest                   # 52 tests (DAG, DataBus, Executor, Registry, server)
cd ..
```

### Day-to-day commands

| Command               | What it does                                                       |
|-----------------------|--------------------------------------------------------------------|
| `pnpm dev`            | `tsc -b --watch` across all TS packages (Turbo orchestrated).      |
| `pnpm build`          | Build all TS packages.                                             |
| `pnpm test`           | Vitest across all TS packages.                                     |
| `pnpm check`          | `biome check .` — lint + format check + import sort, read-only.    |
| `pnpm check:fix`      | `biome check --write .` — apply all auto-fixes.                    |
| `pnpm format`         | `biome format --write .`                                           |
| `uv run notebookflow` | Start the FastAPI engine on `127.0.0.1:8765` (from `engine/`).     |
| `uv run pytest`       | Run engine tests (from `engine/`).                                 |

Per-package commands work too — `cd packages/graph-canvas && pnpm test:watch` for tight TDD loops.

### Working on a single package

The whole repo is a pnpm + Turborepo monorepo. To iterate on just one package:

```powershell
cd packages/graph-canvas
pnpm dev          # watch mode for this package only
pnpm test:watch   # vitest in watch mode
```

Cross-package edits propagate automatically via TypeScript project references — editing `graph-canvas` and rebuilding picks up in `jupyterlab-extension`, `vscode-extension`, and `web-app` without any extra wiring.

### Manual run (without orchestration)

If you'd rather drive the pieces individually:

| Piece            | Command                                                       |
|------------------|---------------------------------------------------------------|
| Engine only      | `pnpm engine`                                                 |
| Web app only     | `pnpm --filter @notebookflow/web-app dev`                     |
| VS Code only     | `pnpm --filter @notebookflow/vscode-extension build && code packages/vscode-extension` (then F5) |
| Jupyter Lab only | `pnpm jupyter:lab` (engine must already be running)           |

### Troubleshooting

- **`pnpm bootstrap` fails on `uv` step** → `uv` isn't on PATH. Install with `winget install astral-sh.uv` (Windows) or `curl -LsSf https://astral.sh/uv/install.sh | sh` (macOS/Linux), then reopen your shell.
- **`pnpm start:vscode` says `code` not found** → install VS Code's `code` CLI shim. In VS Code: command palette → **Shell Command: Install 'code' command in PATH**. Or use the manual fallback: `pnpm --filter @notebookflow/vscode-extension build && code packages/vscode-extension`, then F5 in that window.
- **JupyterLab extension doesn't appear in the palette** → re-run `pnpm jupyter:install` (it re-copies the bundle into the venv), refresh the browser tab. Check **Help → About JupyterLab → Installed Extensions** to confirm `@notebookflow/jupyterlab-extension` is listed.
- **VS Code's engine fails to spawn** → check the **NotebookFlow Engine** output channel for the subprocess error. If `uv` isn't visible to VS Code, set `notebookflow.enginePath` in VS Code settings to an absolute path to a directory containing the engine.

## Implementation status

Phases 1–5d landed: sync engine + canvas + Tailwind/shadcn web-app + Python core (DAG, DataBus, Executor) + node registry with built-in nodes + FastAPI server (`/health`, `/nodes`, `/pipelines/{id}/run`, `/ws`) + VS Code extension (with engine subprocess) + JupyterLab extension (TS source compiles; labextension build expected from the user). Test count: 92 (40 TS sync-engine + 52 Python).

Deferred from the original plan: triggers (`triggers.py`), LLM modules (`pipeline_author`/`code_synth`/`explainer`), `jupyter-server-proxy` auto-launch for the JL adapter, KernelBridge live-kernel execution.
