# JupyterLab release

NotebookFlow is distributed on PyPI as `notebookflow-app`. The shorter
`notebookflow` PyPI name belongs to an unrelated project and must not be used.
The Python import package and command remain `notebookflow`.

## Compatibility

- Python 3.11–3.13
- JupyterLab 4.6.1 or newer, below JupyterLab 5
- One synchronized version in `engine/pyproject.toml`,
  `packages/jupyterlab-extension/package.json`, and
  `scripts/verify_jupyterlab_distribution.py`

Users install or upgrade with:

```bash
python -m pip install --upgrade notebookflow-app
jupyter lab
```

The wheel includes the engine, the prebuilt extension, its settings schema,
and the named `jupyter-server-proxy` entry point. Node.js is only a release
build dependency.

## One-time publisher setup

Create a protected GitHub environment named `pypi`. Then add a pending Trusted
Publisher on PyPI with these exact values:

- PyPI project: `notebookflow-app`
- GitHub owner: `NoelHuibers`
- Repository: `notebookflow`
- Workflow: `release-jupyterlab.yml`
- Environment: `pypi`

The workflow uses GitHub OIDC and does not require a stored PyPI API token.

## Build and test

Run the `Release JupyterLab` workflow manually for a non-publishing dry run.
It installs locked dependencies, builds the prebuilt extension, creates the
wheel and source archive, verifies their metadata and contents, installs the
wheel without Node.js, checks JupyterLab discovery, and starts the engine
through its named proxy route.

The equivalent local artifact checks are:

```bash
pnpm install --frozen-lockfile
uv --project engine sync --all-extras --frozen
pnpm --filter @notebookflow/jupyterlab-extension build:lab
uv build engine --out-dir engine/dist --clear
uv --project engine run python scripts/verify_jupyterlab_distribution.py engine/dist
uv tool run twine check engine/dist/*
```

The generated `engine/notebookflow/labextension/` directory is intentionally
ignored by Git. Release artifacts must always be rebuilt from the tagged
source.

## Publish

After the dry run passes and the Trusted Publisher is ready:

```bash
git tag jupyterlab-v0.1.0
git push origin jupyterlab-v0.1.0
```

The tag must exactly match the package version. The workflow publishes only
after its clean-install smoke test passes.

Verify the release from a fresh environment:

```bash
python -m venv .venv
.venv/bin/python -m pip install notebookflow-app==0.1.0
.venv/bin/python -m jupyterlab.labextensions list
```

On Windows, use `.venv\Scripts\python.exe` in the last two commands.
Confirm the PyPI project page is live and that JupyterLab's Extension Manager
finds `notebookflow-app`.

## Rollback and yanking

PyPI versions are immutable and cannot be reused. If a release is broken:

1. Yank the affected version from the PyPI release page and record the reason.
2. Do not delete the release unless it exposes sensitive data.
3. Fix forward, increment the patch version everywhere listed above, run the
   dry-run workflow, and publish a new tag.
4. Tell affected users to pin the previous good version until the replacement
   is available.

Before widening the JupyterLab or Python compatibility bounds, run the full
artifact smoke test against every newly supported version.
