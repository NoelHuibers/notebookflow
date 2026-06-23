"""Tests for the jupyter-server-proxy entry-point config."""

from __future__ import annotations

from notebookflow.proxy import server_proxy_config


def test_server_proxy_config_uses_notebookflow_console_script() -> None:
    config = server_proxy_config()
    assert config["command"] == ["notebookflow"]


def test_server_proxy_config_passes_port_through_environment() -> None:
    config = server_proxy_config()
    # jupyter-server-proxy substitutes {port} with the allocated port number.
    assert config["environment"]["PORT"] == "{port}"


def test_server_proxy_config_uses_relative_urls() -> None:
    config = server_proxy_config()
    # absolute_url=False keeps the engine rooted under /proxy/<port>/, which
    # is what the JL adapter relies on to build the WS URL.
    assert config["absolute_url"] is False


def test_server_proxy_config_disables_launcher_tile_by_default() -> None:
    """Engine is meant to be invoked by the canvas, not from the launcher."""
    config = server_proxy_config()
    assert config["launcher_entry"]["enabled"] is False
    assert "NotebookFlow" in config["launcher_entry"]["title"]
