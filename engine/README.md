# NotebookFlow Engine

Python execution engine for NotebookFlow. FastAPI + WebSockets server that builds DAGs from notebooks, runs them through a data bus, and exposes pipelines to all platform adapters (JupyterLab, VS Code, web app).

## Layout

```
notebookflow/
├── core/          # DAG, executor, data bus, triggers
├── nodes/         # Built-in node implementations (input/transform/output/ai/io)
├── protocol/      # Extension protocol — manifest, registry, loader
├── llm/           # Pipeline author, code synth, explainer
└── server.py      # FastAPI + WebSocket entry point
```

## Dev setup

```bash
uv sync --all-extras
uv run pytest
uv run ruff check .
uv run ty check
```

## Run the engine

```bash
uv run notebookflow
# or directly:
uv run uvicorn notebookflow.server:app --reload
```
