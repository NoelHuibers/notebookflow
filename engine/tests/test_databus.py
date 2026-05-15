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


def test_put_dataframe_spills_to_parquet_and_get_materializes(
    bus: DataBus, spill_dir: Path
) -> None:
    df = pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})
    bus.put("n1", "df", df)

    files = list(spill_dir.iterdir())
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


def test_clear_node_drops_entries_and_deletes_spill_files(
    bus: DataBus, spill_dir: Path
) -> None:
    df = pd.DataFrame({"a": [1, 2]})
    bus.put("n1", "df", df)
    bus.put("n1", "count", 5)
    bus.put("n2", "df", df)

    assert {k[0] for k in bus.keys()} == {"n1", "n2"}
    assert len(list(spill_dir.iterdir())) == 2

    bus.clear_node("n1")

    assert {k[0] for k in bus.keys()} == {"n2"}
    # Exactly one parquet file remains (n2's df). n1's spill should be gone.
    assert len(list(spill_dir.iterdir())) == 1


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
