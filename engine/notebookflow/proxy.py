"""jupyter-server-proxy configuration.

Exposes the engine through Jupyter's named `/notebookflow/` route. The first
request to that route starts the engine, so the JupyterLab adapter does not
depend on a separately launched process or a fixed port.

Wired via the `jupyter_serverproxy_servers` entry point in pyproject.toml:

    [project.entry-points."jupyter_serverproxy_servers"]
    notebookflow = "notebookflow.proxy:server_proxy_config"
"""

from __future__ import annotations

from typing import Any


def server_proxy_config() -> dict[str, Any]:
    """Tell jupyter-server-proxy how to launch + identify the engine.

    The launch command runs the `notebookflow` console script (declared in
    `[project.scripts]`), which boots uvicorn against the FastAPI app. The
    engine reads `PORT` from the environment so we let jupyter-server-proxy
    pick a free port and pass it through via `{port}`.
    """
    return {
        "command": ["notebookflow"],
        "environment": {"PORT": "{port}"},
        # `absolute_url=False` strips the `/notebookflow/` prefix before
        # forwarding the request; the engine continues to expose `/ws`,
        # `/health`, and its other routes at the root.
        "absolute_url": False,
        # The launcher icon in JL's launcher screen.
        "launcher_entry": {
            "title": "NotebookFlow engine",
            "enabled": False,
        },
        # Cold imports can take more than 30 seconds on Windows and small
        # hosted machines. Keep the first canvas connection alive while the
        # local engine boots.
        "timeout": 90,
    }
