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
    # Self-host maps to the shared "_" tenant namespace.
    assert bus.spill_root == spill_dir / "_" / "run-abc"
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

    # Their spill subdirs are disjoint (under the shared "_" tenant dir).
    assert {p.name for p in (spill_dir / "_").iterdir() if p.is_dir()} == {"run-a", "run-b"}


def test_clear_run_drops_run_keys_and_spill_subdir(spill_dir: Path) -> None:
    bus = DataBus(spill_dir=spill_dir, pipeline_run_id="ephemeral")
    bus.put("n1", "df", pd.DataFrame({"a": [1, 2]}))
    bus.put("n2", "count", 7)
    assert len(bus.keys()) == 2

    bus.clear_run()

    assert bus.keys() == []
    assert not (spill_dir / "_" / "ephemeral").exists()


def test_tenant_namespaces_spill_subdir(spill_dir: Path) -> None:
    anon = DataBus(spill_dir=spill_dir, pipeline_run_id="r")
    alice = DataBus(spill_dir=spill_dir, pipeline_run_id="r", tenant="alice")
    assert anon.tenant == "_"
    assert alice.tenant != "_"
    # Raw user id is hashed, never used verbatim as a path segment.
    assert "alice" not in str(alice.spill_root)
    assert alice.spill_root == spill_dir / alice.tenant / "r"
    assert alice.spill_root != anon.spill_root


def test_two_tenants_same_run_id_isolated_in_shared_store(spill_dir: Path) -> None:
    # Same client-supplied run id, different users, one shared in-memory store.
    a = DataBus(spill_dir=spill_dir, pipeline_run_id="demo", tenant="user-A")
    b = DataBus(spill_dir=spill_dir, pipeline_run_id="demo", tenant="user-B")
    b._store = a._store  # simulate a single shared bus hosting both runs

    a.put("node", "out", 1)
    b.put("node", "out", 2)
    a.put("node", "df", pd.DataFrame({"x": [1]}))
    b.put("node", "df", pd.DataFrame({"x": [2]}))

    # Neither tenant can read the other's payload despite the identical run id.
    assert a.get("node", "out").value == 1
    assert b.get("node", "out").value == 2
    assert a.get("node", "df").value["x"].tolist() == [1]
    assert b.get("node", "df").value["x"].tolist() == [2]
    assert set(a.keys()) == {("node", "out"), ("node", "df")}
    assert set(b.keys()) == {("node", "out"), ("node", "df")}

    # Spill subdirs are per-tenant, so same-run-id parquet files don't collide.
    assert a.spill_root != b.spill_root

    # Clearing one tenant's run leaves the other intact.
    a.clear_run()
    assert a.keys() == []
    assert set(b.keys()) == {("node", "out"), ("node", "df")}


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


def test_get_isolates_mutable_json_between_consumers(bus: DataBus) -> None:
    """Fan-out: two consumers of a list output must not see each other's
    in-place mutations. get() deep-copies JSON payloads on read."""
    bus.put("src", "rows", [1, 2, 3])

    first = bus.get("src", "rows")
    first.value.append(999)  # one branch mutates its copy

    second = bus.get("src", "rows")
    assert second.value == [1, 2, 3]  # sibling branch is unaffected

    # The stored value itself is untouched too.
    assert bus.get("src", "rows").value == [1, 2, 3]


def test_get_isolates_nested_dict_payloads(bus: DataBus) -> None:
    bus.put("src", "cfg", {"opts": {"n": 1}})
    a = bus.get("src", "cfg")
    a.value["opts"]["n"] = 42
    assert bus.get("src", "cfg").value == {"opts": {"n": 1}}
