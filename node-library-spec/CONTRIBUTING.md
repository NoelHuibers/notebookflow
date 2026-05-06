# Contributing a Node Package

Anyone can publish a third-party NotebookFlow node. This doc is the public contract.

## 1. Create a Python package

```
notebookflow-node-sqlquery/
├── pyproject.toml
└── notebookflow_node_sqlquery/
    ├── __init__.py
    └── node_manifest.json
```

## 2. Write `node_manifest.json`

Conform to [`node_manifest.schema.json`](./node_manifest.schema.json):

```json
{
  "id": "community.sqlquery",
  "name": "SQL Query",
  "tag": "io",
  "version": "0.1.0",
  "description": "Run a SQL query against a connection string and return a DataFrame.",
  "inputs":  [{ "name": "conn", "type": "text" }, { "name": "query", "type": "text" }],
  "outputs": [{ "name": "df", "type": "dataframe" }],
  "template": "import pandas as pd\ndf = pd.read_sql(query, conn)\n"
}
```

## 3. Register a discovery entry point

In your `pyproject.toml`:

```toml
[project.entry-points."notebookflow.nodes"]
sqlquery = "notebookflow_node_sqlquery:register"
```

Your `register(registry)` function loads the manifest JSON and calls `registry.register(NodeManifest(**data))`.

## 4. Publish & install

```bash
pip install notebookflow-node-sqlquery
```

The engine's `Registry.discover()` picks it up on next launch — no extra config.

## Tag semantics

| Tag         | Meaning                                                    |
|-------------|------------------------------------------------------------|
| `input`     | Produces data from outside the pipeline (CSV, HTTP, etc.). |
| `transform` | Pure reshaping; no side effects.                           |
| `output`    | Terminal sink (charts, files, dashboards).                 |
| `ai`        | LLM / embedding / classifier calls.                        |
| `io`        | Side-effecting integrations (DB, queue, webhook).          |

## Port types

`dataframe`, `json`, `text`, `fileref`, `any`. Used for type-checking wires at edit time and for routing in the data bus.
