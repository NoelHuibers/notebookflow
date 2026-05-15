"""Tests for the built-in node manifests."""

from __future__ import annotations

from notebookflow.nodes import register as register_builtins
from notebookflow.nodes.input import PARSE_CSV
from notebookflow.nodes.output import PLOT_CHART
from notebookflow.nodes.transform import FILTER_ROWS
from notebookflow.protocol.registry import Registry

_EXPECTED_IDS = {
    "notebookflow.parse_csv",
    "notebookflow.filter_rows",
    "notebookflow.plot_chart",
}


def test_register_loads_three_builtin_manifests() -> None:
    registry = Registry()
    register_builtins(registry)
    assert {m.id for m in registry.all()} == _EXPECTED_IDS


def test_parse_csv_manifest_shape() -> None:
    assert PARSE_CSV.tag == "input"
    assert PARSE_CSV.inputs == []
    assert PARSE_CSV.outputs[0].name == "df"
    assert PARSE_CSV.outputs[0].type == "dataframe"
    assert "pandas" in PARSE_CSV.template
    assert "read_csv" in PARSE_CSV.template


def test_filter_rows_manifest_shape() -> None:
    assert FILTER_ROWS.tag == "transform"
    assert FILTER_ROWS.inputs[0].name == "df"
    assert FILTER_ROWS.outputs[0].name == "df"
    assert FILTER_ROWS.template.strip() != ""


def test_plot_chart_manifest_shape() -> None:
    assert PLOT_CHART.tag == "output"
    assert PLOT_CHART.inputs[0].name == "df"
    assert PLOT_CHART.outputs == []
    assert "plot" in PLOT_CHART.template


def test_register_is_idempotent_against_fresh_registry() -> None:
    """Calling ``register`` twice against fresh registries yields the same set."""
    a = Registry()
    register_builtins(a)
    b = Registry()
    register_builtins(b)
    assert {m.id for m in a.all()} == {m.id for m in b.all()}


def test_register_twice_against_same_registry_raises() -> None:
    """Second call detects the duplicate ids — the registry's conflict policy."""
    registry = Registry()
    register_builtins(registry)
    try:
        register_builtins(registry)
    except ValueError as exc:
        assert "already registered" in str(exc)
    else:
        raise AssertionError("expected ValueError on duplicate registration")
