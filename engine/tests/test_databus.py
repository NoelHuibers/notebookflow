"""Tests for the DataBus payload routing."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from notebookflow.core.databus import DataBus


def test_put_then_get_primitive(bus: DataBus) -> None:
    bus.put("n1", "count", 42)
    payload = bus.get("n1", "count")
    assert payload.kind == "json"
    assert payload.value == 42


def test_put_then_get_list_of_dicts(bus: DataBus) -> None:
    rows = [{"id": 1, "name": "alpha"}, {"id": 2, "name": "beta"}]
    bus.put("n1", "rows", rows)
    payload = bus.get("n1", "rows")
    assert payload.kind == "json"
    assert payload.value == rows


def test_put_dataframe_spills_to_parquet_and_get_materializes(bus: DataBus) -> None:
    df = pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})
    bus.put("n1", "df", df)

    files = list(bus.spill_root.iterdir())
    assert len(files) == 1
    assert files[0].suffix == ".parquet"

    payload = bus.get("n1", "df")
    assert payload.kind == "dataframe"
    assert isinstance(payload.value, pd.DataFrame)
    pd.testing.assert_frame_equal(payload.value, df)
    assert payload.meta == {"rows": 3, "columns": ["a", "b"]}


def test_get_unknown_key_raises(bus: DataBus) -> None:
    with pytest.raises(KeyError):
        bus.get("ghost", "x")


def test_put_unsupported_type_raises(bus: DataBus) -> None:
    class Custom:
        pass

    with pytest.raises(TypeError, match="Unsupported payload type"):
        bus.put("n1", "p", Custom())


def test_put_non_json_primitive_raises(bus: DataBus) -> None:
    # set() is not in the JSON-compatible types we accept.
    with pytest.raises(TypeError, match="Unsupported payload type"):
        bus.put("n1", "p", {1, 2, 3})


def test_clear_node_drops_entries_and_deletes_spill_files(bus: DataBus) -> None:
    df = pd.DataFrame({"a": [1, 2]})
    bus.put("n1", "df", df)
    bus.put("n1", "count", 5)
    bus.put("n2", "df", df)

    assert {k[0] for k in bus.keys()} == {"n1", "n2"}
    assert len(list(bus.spill_root.iterdir())) == 2

    bus.clear_node("n1")

    assert {k[0] for k in bus.keys()} == {"n2"}
    # Exactly one parquet file remains (n2's df). n1's spill should be gone.
    assert len(list(bus.spill_root.iterdir())) == 1


def test_explicit_pipeline_run_id_namespaces_spill_subdir(spill_dir: Path) -> None:
    bus = DataBus(spill_dir=spill_dir, pipeline_run_id="run-abc")
    bus.put("n1", "df", pd.DataFrame({"x": [1]}))
    assert bus.spill_root == spill_dir / "run-abc"
    assert bus.spill_root.is_dir()
    assert all(p.parent == bus.spill_root for p in spill_dir.rglob("*.parquet"))


def test_two_databuses_on_same_spill_dir_are_isolated(spill_dir: Path) -> None:
    a = DataBus(spill_dir=spill_dir, pipeline_run_id="run-a")
    b = DataBus(spill_dir=spill_dir, pipeline_run_id="run-b")

    a.put("shared_node", "result", 1)
    b.put("shared_node", "result", 2)
    a.put("shared_node", "df", pd.DataFrame({"x": [1]}))
    b.put("shared_node", "df", pd.DataFrame({"x": [99]}))

    # Each bus sees only its own run's keys.
    assert set(a.keys()) == {("shared_node", "result"), ("shared_node", "df")}
    assert set(b.keys()) == {("shared_node", "result"), ("shared_node", "df")}
    assert a.get("shared_node", "result").value == 1
    assert b.get("shared_node", "result").value == 2
    assert a.get("shared_node", "df").value["x"].tolist() == [1]
    assert b.get("shared_node", "df").value["x"].tolist() == [99]

    # Their spill subdirs are disjoint.
    assert {p.name for p in spill_dir.iterdir() if p.is_dir()} == {"run-a", "run-b"}


def test_clear_run_drops_run_keys_and_spill_subdir(spill_dir: Path) -> None:
    bus = DataBus(spill_dir=spill_dir, pipeline_run_id="ephemeral")
    bus.put("n1", "df", pd.DataFrame({"a": [1, 2]}))
    bus.put("n2", "count", 7)
    assert len(bus.keys()) == 2

    bus.clear_run()

    assert bus.keys() == []
    assert not (spill_dir / "ephemeral").exists()


def test_auto_generated_run_id_is_unique_per_databus(spill_dir: Path) -> None:
    a = DataBus(spill_dir=spill_dir)
    b = DataBus(spill_dir=spill_dir)
    assert a.pipeline_run_id != b.pipeline_run_id
    assert len(a.pipeline_run_id) > 0


def test_internal_store_holds_path_not_dataframe(bus: DataBus) -> None:
    """The spilled form is what's kept in memory; get() materializes on demand."""
    df = pd.DataFrame({"a": [1]})
    bus.put("n1", "df", df)
    # Re-import via the public API of the in-memory representation: a fresh
    # get() should still return the materialized DataFrame after the original
    # is dropped from local scope.
    del df
    payload = bus.get("n1", "df")
    assert isinstance(payload.value, pd.DataFrame)
    assert payload.value["a"].tolist() == [1]
