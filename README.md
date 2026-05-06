# NotebookFlow

n8n-style workflow orchestration for computational notebooks. Visually wire together Jupyter notebooks and cell groups into pipelines, with AI assistance, a node library, and full bidirectional sync between the visual graph and the actual notebook cells.

## The thesis

Flowco (UIST 2025) proved that a dataflow graph is a better authoring model than a linear notebook — but it replaces the notebook entirely. NotebookFlow extends notebooks instead. The `.ipynb` file is always the source of truth. The graph is derived from it.

## Two-level data model

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

## Bidirectional sync — the core research contribution

The `.ipynb` file is always the source of truth. The graph is derived, never primary.

- **Cell → Graph:** parse `# @node` markers on file save → rebuild graph model automatically.
- **Graph → Cell:** rename a node or draw a wire → inject or update `# @node` markers in the notebook cells.
- **Conflict rule:** cell editor always wins on direct edit. Timestamp-based resolution otherwise.

This is what distinguishes NotebookFlow from Flowco: we extend notebooks rather than replacing them.

## Architecture layers

1. **Platform Adapters** — JupyterLab extension, VS Code extension, standalone web app. All share the same graph canvas component and talk to the core engine via WebSocket.
2. **View Layer** — Shared React + React Flow graph canvas, notebook cell view, sync engine ([MarkerParser.ts](packages/graph-canvas/src/sync/MarkerParser.ts), [SyncEngine.ts](packages/graph-canvas/src/sync/SyncEngine.ts)).
3. **Core Engine** — Python (FastAPI + WebSockets): DAG builder, executor, data bus (Parquet/JSON/file refs), trigger system.
4. **Node Library** — Built-in nodes tagged `input` / `transform` / `output` / `ai` / `io`. Third parties publish via the extension protocol.
5. **Extension Protocol** — Node packages declare a `node_manifest.json`. Installed via `pip install`, discovered via Python entry points.
6. **LLM Assistance** — Pipeline author (NL → pipeline), code synthesiser (per-node code), explainer (graph → prose).

## Platform communication

- **JupyterLab:** Jupyter Server Extension shim auto-launches FastAPI and proxies via `jupyter-server-proxy`. Zero extra setup.
- **VS Code:** Extension auto-launches the Python process on activation, connects to FastAPI WebSocket.
- **Standalone Web App:** Connects to a remotely hosted FastAPI instance, or a locally running one.

The real engine always lives in FastAPI. JupyterLab just gets a thin shim on top.

## Tech stack

**Frontend (TypeScript):** pnpm, Turborepo, React, React Flow, tsc, Vitest, ESLint, Prettier.

**Backend (Python):** uv, Ruff, ty, pytest, FastAPI, WebSockets.

## Repo layout

```
notebookflow/
├── packages/
│   ├── graph-canvas/         # Shared React + React Flow component
│   ├── jupyterlab-extension/ # JupyterLab platform adapter
│   ├── vscode-extension/     # VS Code platform adapter
│   └── web-app/              # Standalone web app (future)
├── engine/                   # Python backend (FastAPI + WebSocket)
├── node-library-spec/        # Public extension protocol spec
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

## Getting started

### Prerequisites

| Tool   | Version  | Notes                                                                |
|--------|----------|----------------------------------------------------------------------|
| Node   | `>=20`   | Required by every TS package.                                        |
| pnpm   | `>=10`   | Pinned via `packageManager` in [package.json](package.json) — `corepack enable` will pick it up. |
| Python | `>=3.11` | Required by the engine.                                              |
| uv     | latest   | Astral's package manager — used for the engine.                      |

### Install

```powershell
# TypeScript packages
pnpm install

# Python engine
cd engine
uv sync --all-extras
cd ..
```

### Verify the scaffolding

Everything below should pass on a clean checkout (the source files are stubs that throw `NotImplementedError`/`Error("not implemented")` at runtime, but they're fully type-safe and lint-clean).

```powershell
pnpm typecheck                  # tsc -b across all TS packages
pnpm lint                       # flat ESLint config, type-aware

cd engine
uv run ruff check .
uv run ty check
uv run pytest                   # no tests yet — exits 0 with "no tests collected"
cd ..
```

### Day-to-day commands

| Command              | What it does                                                     |
|----------------------|------------------------------------------------------------------|
| `pnpm dev`           | `tsc -b --watch` across all TS packages (Turbo orchestrated).    |
| `pnpm build`         | Build all TS packages.                                           |
| `pnpm test`          | Vitest across all TS packages.                                   |
| `pnpm lint:fix`      | ESLint with `--fix`.                                             |
| `pnpm format`        | Prettier.                                                        |
| `uv run notebookflow`| Start the FastAPI engine on `127.0.0.1:8765`.                    |
| `uv run pytest`      | Run engine tests (from `engine/`).                               |

Per-package commands work too — `cd packages/graph-canvas && pnpm test:watch` for tight TDD loops.

### Working on a single package

The whole repo is a pnpm + Turborepo monorepo. To iterate on just one package:

```powershell
cd packages/graph-canvas
pnpm dev          # watch mode for this package only
pnpm test:watch   # vitest in watch mode
```

Cross-package edits propagate automatically via TypeScript project references — editing `graph-canvas` and rebuilding picks up in `jupyterlab-extension`, `vscode-extension`, and `web-app` without any extra wiring.

### Running each platform adapter

| Adapter                | How to run it                                                      |
|------------------------|--------------------------------------------------------------------|
| Engine (standalone)    | `cd engine && uv run notebookflow` — FastAPI at `127.0.0.1:8765`.  |
| JupyterLab extension   | `pnpm --filter @notebookflow/jupyterlab-extension build`, then `jupyter labextension develop engine --overwrite` and `jupyter lab`. |
| VS Code extension      | `pnpm --filter @notebookflow/vscode-extension build`, then F5 in VS Code with the package open (Run Extension launch config). |
| Web app                | `pnpm --filter @notebookflow/web-app dev` — Vite dev server.       |

(All four are stubs today; they'll throw on activation until the underlying components are implemented.)

## Implementation status

Scaffolding stage. Every source file under `packages/` and `engine/notebookflow/` is a typed stub with a docstring explaining what it does and a `TODO`/`NotImplementedError` for the body.

Recommended implementation order — bottom-up, sync engine first because it's the differentiator and has no dependencies:

```
MarkerParser.ts → SyncEngine.ts → dag.py → executor.py
  → graph canvas → node library → extension protocol
```

The first useful vertical slice: parse a real `.ipynb` with two `# @node` markers → render two boxes on a canvas → rename one in the canvas → see the marker update in the file. That exercises [MarkerParser](packages/graph-canvas/src/sync/MarkerParser.ts) + [SyncEngine](packages/graph-canvas/src/sync/SyncEngine.ts) + [Canvas](packages/graph-canvas/src/components/Canvas.tsx) without needing the executor or any platform adapter.
