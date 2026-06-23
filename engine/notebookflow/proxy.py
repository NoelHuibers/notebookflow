"""jupyter-server-proxy configuration.

Exposes the engine through Jupyter's `/proxy/<port>/` endpoint when
jupyter-server-proxy is installed alongside JupyterLab. With this hooked up,
the JupyterLab adapter can connect via the relative URL `/proxy/8765/ws`
instead of relying on a separately-launched engine on a known host:port.

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
        # `absolute_url=False` keeps the proxy rooted at /proxy/<port>/ so a
        # relative WebSocket URL ("/proxy/<port>/ws") works from the JL UI.
        "absolute_url": False,
        # The launcher icon in JL's launcher screen.
        "launcher_entry": {
            "title": "NotebookFlow engine",
            "enabled": False,
        },
        "timeout": 30,
    }
