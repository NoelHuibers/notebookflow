# NotebookFlow for JupyterLab

NotebookFlow adds a visual pipeline editor and local execution engine to
JupyterLab.

## Install

```bash
pip install notebookflow-app
jupyter lab
```

Open a notebook and launch NotebookFlow from the command palette. The Python
package contains both the prebuilt JupyterLab extension and the engine; a Node
installation and a repository checkout are not required. The engine starts
automatically through `jupyter-server-proxy` when the extension first connects.

NotebookFlow supports Python 3.11–3.13 and JupyterLab 4.6 or newer.

The PyPI distribution is named `notebookflow-app`; the `notebookflow` command
and Python import package keep their shorter names.

## Engine

The engine is a FastAPI and WebSocket server that builds DAGs from notebooks,
runs them through a data bus, and exposes pipelines to platform adapters
(JupyterLab, VS Code, and the web app).

## Layout

```text
notebookflow/
├── core/          # DAG, executor, data bus, triggers
├── nodes/         # Built-in node implementations
├── protocol/      # Extension manifest, registry, loader
├── llm/           # Pipeline author, code synthesis, explainer
└── server.py      # FastAPI + WebSocket entry point
```

## Development

```bash
cd engine
uv sync --all-extras
uv run pytest
uv run ruff check .
uv run ty check
```

Build the prebuilt extension from the repository root:

```bash
pnpm --filter @notebookflow/jupyterlab-extension build:lab
uv build engine
```

The complete Trusted Publishing, upgrade, and rollback procedure is in
[`docs/releases/jupyterlab.md`](../docs/releases/jupyterlab.md).

## Run the engine directly

```bash
uv run notebookflow
# Or directly:
uv run uvicorn notebookflow.server:app --reload
```
