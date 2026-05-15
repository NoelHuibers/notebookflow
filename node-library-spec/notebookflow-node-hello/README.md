# notebookflow-node-hello

Reference implementation of the [NotebookFlow extension protocol](../CONTRIBUTING.md).

The package contributes one transform node, `community.hello`, that prepends a greeting to a name string.

## Install

```bash
pip install -e ./notebookflow-node-hello
```

Once installed alongside `notebookflow`, the engine's `Registry.discover()` picks it up automatically via the `notebookflow.nodes` entry point declared in `pyproject.toml`.

## Layout

```
notebookflow-node-hello/
├── pyproject.toml                  # declares the [notebookflow.nodes] entry point
├── README.md
└── notebookflow_node_hello/
    ├── __init__.py                 # exports `register(registry)` — the entry point
    └── node_manifest.json          # validates against node_manifest.schema.json
```

`__init__.register` is the function the engine invokes on discovery. It loads the JSON manifest, validates it through the pydantic `NodeManifest` model, and hands it to the registry.

## Verify locally without installing

The engine tests cover this package via a monkeypatched `importlib.metadata.entry_points`, so you don't need to `pip install` it to confirm the structure works. See `engine/tests/test_registry.py`.
