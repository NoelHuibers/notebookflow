"""Tests for the node manifest registry and entry-point discovery."""

from __future__ import annotations

import importlib.metadata
import importlib.util
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from notebookflow.protocol.manifest import NodeManifest
from notebookflow.protocol.registry import Registry

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_SAMPLE_INIT = (
    _REPO_ROOT
    / "node-library-spec"
    / "notebookflow-node-hello"
    / "notebookflow_node_hello"
    / "__init__.py"
)


class _FakeEntryPoint:
    """Minimal stand-in for ``importlib.metadata.EntryPoint``."""

    def __init__(self, name: str, register_func: Callable[[Registry], None]) -> None:
        self.name = name
        self._register_func = register_func

    def load(self) -> Callable[[Registry], None]:
        return self._register_func


def _patch_entry_points(
    monkeypatch: pytest.MonkeyPatch,
    entries: list[_FakeEntryPoint],
) -> None:
    def fake_entry_points(*, group: str) -> list[_FakeEntryPoint]:
        return entries if group == "notebookflow.nodes" else []

    monkeypatch.setattr(importlib.metadata, "entry_points", fake_entry_points)


def test_register_and_get_round_trip() -> None:
    registry = Registry()
    manifest = NodeManifest(id="x.foo", name="Foo", tag="transform")
    registry.register(manifest)
    assert registry.get("x.foo") is manifest


def test_register_rejects_duplicate_id() -> None:
    registry = Registry()
    registry.register(NodeManifest(id="x.foo", name="Foo", tag="transform", version="0.1.0"))
    with pytest.raises(ValueError, match="already registered"):
        registry.register(
            NodeManifest(id="x.foo", name="Foo again", tag="transform", version="0.2.0")
        )


def test_get_unknown_raises_keyerror() -> None:
    registry = Registry()
    with pytest.raises(KeyError):
        registry.get("nope")


def test_all_iterates_registered_manifests_in_insertion_order() -> None:
    registry = Registry()
    ids = ["a.x", "b.y", "c.z"]
    for nid in ids:
        registry.register(NodeManifest(id=nid, name=nid, tag="transform"))
    assert [m.id for m in registry.all()] == ids


def test_discover_invokes_each_entry_point(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def fake_register(registry: Registry) -> None:
        calls.append("fake")
        registry.register(NodeManifest(id="ext.foo", name="Foo", tag="transform"))

    _patch_entry_points(monkeypatch, [_FakeEntryPoint("fake", fake_register)])

    registry = Registry.discover()
    assert calls == ["fake"]
    assert registry.get("ext.foo").id == "ext.foo"


def test_discover_with_no_entry_points_returns_empty_registry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_entry_points(monkeypatch, [])
    registry = Registry.discover()
    assert list(registry.all()) == []


def _load_sample_external_module() -> Any:
    """Import the on-disk sample external package as if it were pip-installed.

    Returned as ``Any`` so attribute access on the dynamically-loaded module
    (``register``, ``load_manifest``) doesn't need per-attribute type
    annotations on the static analyser side.
    """
    spec = importlib.util.spec_from_file_location("notebookflow_node_hello", _SAMPLE_INIT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["notebookflow_node_hello"] = module
    spec.loader.exec_module(module)
    return module


def test_discover_picks_up_builtins_and_sample_external_package(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """End-to-end: simulate `pip install` by loading the sample from disk.

    The sample lives at ``node-library-spec/notebookflow-node-hello/``. We
    load its ``register`` function directly (bypassing pip), then expose it
    through a monkeypatched ``importlib.metadata.entry_points`` alongside
    the built-in entry-point function. ``Registry.discover()`` should then
    return both contributions in one registry.
    """
    from notebookflow.nodes import register as register_builtins  # local import for clarity

    sample = _load_sample_external_module()

    _patch_entry_points(
        monkeypatch,
        [
            _FakeEntryPoint("builtin", register_builtins),
            _FakeEntryPoint("hello", sample.register),
        ],
    )

    registry = Registry.discover()
    ids = {m.id for m in registry.all()}
    assert {
        "notebookflow.ai_python_transform",
        "notebookflow.parse_csv",
        "notebookflow.filter_rows",
        "notebookflow.plot_chart",
        "community.hello",
    } <= ids


def test_sample_external_manifest_json_validates_against_pydantic_model() -> None:
    """The on-disk JSON manifest must validate through ``NodeManifest``."""
    sample = _load_sample_external_module()
    manifest = sample.load_manifest()
    assert manifest.id == "community.hello"
    assert manifest.tag == "transform"
    assert manifest.inputs[0].name == "name"
    assert manifest.outputs[0].name == "greeting"
