"""Tests for the synchronous executor."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from notebookflow.core.dag import DAG, DAGEdge, DAGNode
from notebookflow.core.databus import DataBus
from notebookflow.core.executor import Executor, _introspect_outputs, _parse_ref


async def test_run_empty_pipeline_returns_no_results(bus: DataBus) -> None:
    executor = Executor(DAG(), bus)
    results = await executor.run_pipeline()
    assert results == []


async def test_run_pipeline_executes_nodes_in_topological_order(
    bus: DataBus, runnable_dag: DAG
) -> None:
    executor = Executor(runnable_dag, bus)
    results = await executor.run_pipeline()

    assert [r.node_id for r in results] == ["a", "b", "c"]
    assert all(r.status == "ok" for r in results)


async def test_run_pipeline_routes_values_through_databus(
    bus: DataBus, runnable_dag: DAG
) -> None:
    executor = Executor(runnable_dag, bus)
    await executor.run_pipeline()

    a_df = bus.get("a", "df").value
    b_clean = bus.get("b", "clean").value
    c_total = bus.get("c", "total").value

    assert a_df == [1, 2, 3, 4, 5]
    assert b_clean == [1, 3, 5]
    assert c_total == 9


async def test_run_pipeline_with_dataframe_payload(bus: DataBus) -> None:
    dag = DAG()
    dag.add_node(
        DAGNode(
            id="a",
            name="A",
            tag="input",
            outputs=["df"],
            source="import pandas as pd\ndf = pd.DataFrame({'x': [1, 2, 3]})\n",
        )
    )
    dag.add_node(
        DAGNode(
            id="b",
            name="B",
            tag="transform",
            inputs=["A.df"],
            outputs=["doubled"],
            source="doubled = df.assign(x=df['x'] * 2)\n",
        )
    )
    dag.add_edge(DAGEdge("a", "df", "b", "A.df"))

    executor = Executor(dag, bus)
    results = await executor.run_pipeline()
    assert [r.status for r in results] == ["ok", "ok"]

    doubled = bus.get("b", "doubled").value
    assert isinstance(doubled, pd.DataFrame)
    assert doubled["x"].tolist() == [2, 4, 6]


async def test_run_pipeline_halts_on_error_and_skips_remainder(bus: DataBus) -> None:
    dag = DAG()
    dag.add_node(DAGNode(id="a", name="A", tag="input", outputs=["x"], source="x = 1\n"))
    dag.add_node(
        DAGNode(
            id="b",
            name="B",
            tag="transform",
            inputs=["A.x"],
            outputs=["y"],
            source="raise RuntimeError('boom')\n",
        )
    )
    dag.add_node(
        DAGNode(
            id="c",
            name="C",
            tag="output",
            inputs=["B.y"],
            source="print(y)\n",
        )
    )
    dag.add_edge(DAGEdge("a", "x", "b", "A.x"))
    dag.add_edge(DAGEdge("b", "y", "c", "B.y"))

    executor = Executor(dag, bus)
    results = await executor.run_pipeline()

    assert [r.status for r in results] == ["ok", "error", "skipped"]
    assert results[1].error is not None
    assert "RuntimeError" in results[1].error
    assert "boom" in results[1].error


async def test_run_pipeline_resets_namespace_between_runs(
    bus: DataBus, runnable_dag: DAG
) -> None:
    executor = Executor(runnable_dag, bus)
    await executor.run_pipeline()
    # Mutate the namespace under the executor to simulate stale state.
    executor.namespace["sentinel"] = "stale"
    await executor.run_pipeline()
    assert "sentinel" not in executor.namespace


async def test_run_node_records_timing(bus: DataBus) -> None:
    node = DAGNode(id="a", name="A", tag="input", outputs=["x"], source="x = 1\n")
    executor = Executor(DAG(), bus)
    result = await executor.run_node(node, inputs={})
    assert result.status == "ok"
    assert result.duration_ms >= 0.0


@pytest.mark.parametrize("bad_source", ["1 / 0\n", "undefined_name\n", "raise ValueError('x')\n"])
async def test_run_node_returns_error_result_for_failing_source(
    bus: DataBus, bad_source: str
) -> None:
    node = DAGNode(id="a", name="A", tag="transform", source=bad_source)
    executor = Executor(DAG(), bus)
    result = await executor.run_node(node, inputs={})
    assert result.status == "error"
    assert result.error is not None


async def test_run_node_captures_stdout(bus: DataBus) -> None:
    node = DAGNode(id="a", name="A", tag="output", source="print('hello'); print('world')\n")
    result = await Executor(DAG(), bus).run_node(node, inputs={})
    assert result.status == "ok"
    assert result.outputs == [
        {"output_type": "stream", "name": "stdout", "text": "hello\nworld\n"},
    ]


async def test_run_node_captures_stderr(bus: DataBus) -> None:
    node = DAGNode(
        id="a",
        name="A",
        tag="output",
        source="import sys\nsys.stderr.write('oops\\n')\n",
    )
    result = await Executor(DAG(), bus).run_node(node, inputs={})
    assert result.status == "ok"
    assert result.outputs == [
        {"output_type": "stream", "name": "stderr", "text": "oops\n"},
    ]


async def test_run_node_captures_display_data_for_plain_object(bus: DataBus) -> None:
    node = DAGNode(id="a", name="A", tag="output", source="display({'k': 1})\n")
    result = await Executor(DAG(), bus).run_node(node, inputs={})
    assert result.status == "ok"
    assert len(result.outputs) == 1
    out = result.outputs[0]
    assert out["output_type"] == "display_data"
    assert out["data"]["text/plain"] == "{'k': 1}"
    assert "text/html" not in out["data"]


async def test_run_node_captures_display_data_with_html_for_dataframe(bus: DataBus) -> None:
    src = (
        "import pandas as pd\n"
        "display(pd.DataFrame({'x': [1, 2]}))\n"
    )
    node = DAGNode(id="a", name="A", tag="output", source=src)
    result = await Executor(DAG(), bus).run_node(node, inputs={})
    assert result.status == "ok"
    assert len(result.outputs) == 1
    out = result.outputs[0]
    assert out["output_type"] == "display_data"
    assert "<table" in out["data"]["text/html"]
    assert "text/plain" in out["data"]


async def test_run_node_captures_matplotlib_figure_as_png(bus: DataBus) -> None:
    src = (
        "import matplotlib\n"
        "matplotlib.use('Agg')\n"
        "import matplotlib.pyplot as plt\n"
        "fig, ax = plt.subplots()\n"
        "ax.bar(['a', 'b'], [1, 2])\n"
    )
    node = DAGNode(id="a", name="Plot", tag="output", source=src)
    result = await Executor(DAG(), bus).run_node(node, inputs={})
    assert result.status == "ok"
    pngs = [
        out
        for out in result.outputs
        if out["output_type"] == "display_data" and "image/png" in out["data"]
    ]
    assert len(pngs) == 1
    assert isinstance(pngs[0]["data"]["image/png"], str)
    assert pngs[0]["data"]["image/png"] != ""


async def test_run_node_without_plot_emits_no_figure(bus: DataBus) -> None:
    node = DAGNode(id="a", name="A", tag="transform", source="x = 1 + 1\n")
    result = await Executor(DAG(), bus).run_node(node, inputs={})
    assert result.status == "ok"
    assert all("image/png" not in out.get("data", {}) for out in result.outputs)


async def test_run_node_reads_uploaded_file_from_data_dir(
    bus: DataBus, tmp_path: Path
) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "nums.csv").write_text("value\n1\n2\n3\n")
    src = "import pandas as pd\nrows = len(pd.read_csv('nums.csv'))\n"
    node = DAGNode(id="a", name="A", tag="input", outputs=["rows"], source=src)
    executor = Executor(DAG(), bus, data_dir=data_dir)
    result = await executor.run_node(node, inputs={})
    assert result.status == "ok"
    assert executor.namespace["rows"] == 3


async def test_run_node_emits_error_output_for_exception(bus: DataBus) -> None:
    node = DAGNode(id="a", name="A", tag="transform", source="raise RuntimeError('boom')\n")
    result = await Executor(DAG(), bus).run_node(node, inputs={})
    assert result.status == "error"
    assert len(result.outputs) == 1
    out = result.outputs[0]
    assert out["output_type"] == "error"
    assert out["ename"] == "RuntimeError"
    assert out["evalue"] == "boom"
    assert any("RuntimeError" in line for line in out["traceback"])


async def test_run_node_emits_error_output_after_partial_stdout(bus: DataBus) -> None:
    src = "print('before')\nraise ValueError('nope')\n"
    node = DAGNode(id="a", name="A", tag="transform", source=src)
    result = await Executor(DAG(), bus).run_node(node, inputs={})
    assert result.status == "error"
    assert [o["output_type"] for o in result.outputs] == ["stream", "error"]
    assert result.outputs[0]["text"] == "before\n"
    assert result.outputs[1]["ename"] == "ValueError"


async def test_run_node_preserves_order_across_stdout_display_stdout(bus: DataBus) -> None:
    src = "print('a')\ndisplay('b')\nprint('c')\n"
    node = DAGNode(id="a", name="A", tag="output", source=src)
    result = await Executor(DAG(), bus).run_node(node, inputs={})
    assert result.status == "ok"
    assert [o["output_type"] for o in result.outputs] == ["stream", "display_data", "stream"]
    assert result.outputs[0]["text"] == "a\n"
    assert result.outputs[1]["data"]["text/plain"] == "'b'"
    assert result.outputs[2]["text"] == "c\n"


async def test_run_node_with_no_output_returns_empty_outputs(bus: DataBus) -> None:
    node = DAGNode(id="a", name="A", tag="transform", source="x = 1\n")
    result = await Executor(DAG(), bus).run_node(node, inputs={})
    assert result.status == "ok"
    assert result.outputs == []


async def test_run_pipeline_attaches_outputs_per_node(bus: DataBus) -> None:
    dag = DAG()
    dag.add_node(
        DAGNode(id="a", name="A", tag="input", outputs=["x"], source="print('A'); x = 1\n"),
    )
    dag.add_node(
        DAGNode(
            id="b",
            name="B",
            tag="output",
            inputs=["A.x"],
            source="print(f'B={x}')\n",
        ),
    )
    dag.add_edge(DAGEdge("a", "x", "b", "A.x"))
    results = await Executor(dag, bus).run_pipeline()
    assert [r.status for r in results] == ["ok", "ok"]
    assert results[0].outputs[0]["text"] == "A\n"
    assert results[1].outputs[0]["text"] == "B=1\n"


async def test_run_node_metadata_reports_dataframe_shape(bus: DataBus) -> None:
    src = "import pandas as pd\ndf = pd.DataFrame({'x': [1, 2, 3], 'y': [4, 5, 6]})\n"
    node = DAGNode(id="a", name="A", tag="input", outputs=["df"], source=src)
    result = await Executor(DAG(), bus).run_node(node, inputs={})
    assert result.status == "ok"
    assert result.metadata == {"rows": 3, "cols": 2}


async def test_run_node_metadata_reports_length_for_list_output(bus: DataBus) -> None:
    node = DAGNode(id="a", name="A", tag="input", outputs=["rows"], source="rows = [1, 2, 3, 4]\n")
    result = await Executor(DAG(), bus).run_node(node, inputs={})
    assert result.metadata == {"rows": 4}


async def test_run_node_metadata_empty_for_scalar_output(bus: DataBus) -> None:
    node = DAGNode(id="a", name="A", tag="input", outputs=["n"], source="n = 42\n")
    result = await Executor(DAG(), bus).run_node(node, inputs={})
    assert result.status == "ok"
    assert result.metadata == {}


async def test_run_node_metadata_skips_str_and_dict_outputs(bus: DataBus) -> None:
    # str/bytes/dict have a length but it's not a meaningful "row count".
    node = DAGNode(
        id="a",
        name="A",
        tag="input",
        outputs=["text"],
        source="text = 'hello world'\n",
    )
    result = await Executor(DAG(), bus).run_node(node, inputs={})
    assert result.metadata == {}


def test_introspect_outputs_tolerates_broken_len() -> None:
    # A buggy __len__ must not raise -- the helper just yields no hint. Tested
    # directly because the DataBus only accepts DataFrames + JSON primitives,
    # so such an object can never reach introspection through run_node.
    class Bad:
        def __len__(self) -> int:
            raise RuntimeError("no length")

    assert _introspect_outputs({"out": Bad()}, ["out"]) == {}


def test_introspect_outputs_prefers_2d_shape_over_len() -> None:
    class Framey:
        shape = (12438, 5)

        def __len__(self) -> int:
            return 12438

    assert _introspect_outputs({"df": Framey()}, ["df"]) == {"rows": 12438, "cols": 5}


def test_introspect_outputs_walks_ports_in_order() -> None:
    # First sized output wins; a scalar earlier in the list is skipped.
    namespace = {"n": 7, "rows": [1, 2, 3]}
    assert _introspect_outputs(namespace, ["n", "rows"]) == {"rows": 3}


async def test_run_node_metadata_empty_on_error(bus: DataBus) -> None:
    src = "raise ValueError('x')\n"
    node = DAGNode(id="a", name="A", tag="transform", outputs=["x"], source=src)
    result = await Executor(DAG(), bus).run_node(node, inputs={})
    assert result.status == "error"
    assert result.metadata == {}


def test_parse_ref_local_uses_own_alias() -> None:
    assert _parse_ref("Load CSV.df", "a") == ("a", "Load CSV", "df")


def test_parse_ref_qualified_uses_explicit_alias() -> None:
    assert _parse_ref("other:Load CSV.df", "a") == ("other", "Load CSV", "df")


def test_parse_ref_without_port_returns_none() -> None:
    assert _parse_ref("no_port_here", "a") is None


async def test_run_pipeline_resolves_cross_notebook_alias_ref(bus: DataBus) -> None:
    # Two notebooks: alias "a" produces df; alias "b" consumes a:Load.df.
    dag = DAG()
    dag.add_node(
        DAGNode(
            id="a::0",
            name="Load",
            tag="input",
            alias="a",
            outputs=["df"],
            source="import pandas as pd\ndf = pd.DataFrame({'x': [1, 2, 3]})\n",
        )
    )
    dag.add_node(
        DAGNode(
            id="b::0",
            name="Use",
            tag="transform",
            alias="b",
            inputs=["a:Load.df"],
            outputs=["rows"],
            source="rows = len(df)\n",
        )
    )
    dag.add_edge(DAGEdge("a::0", "df", "b::0", "a:Load.df"))

    results = await Executor(dag, bus).run_pipeline()
    assert [r.status for r in results] == ["ok", "ok"]
    assert bus.get("b::0", "rows").value == 3


async def test_cross_notebook_same_name_nodes_do_not_collide(bus: DataBus) -> None:
    # Both notebooks have a node named "Load"; the qualified ref must pick the
    # right one rather than colliding on the bare name.
    dag = DAG()
    dag.add_node(
        DAGNode(id="a::0", name="Load", tag="input", alias="a", outputs=["v"], source="v = 10\n")
    )
    dag.add_node(
        DAGNode(id="b::0", name="Load", tag="input", alias="b", outputs=["v"], source="v = 99\n")
    )
    dag.add_node(
        DAGNode(
            id="c::0",
            name="Sink",
            tag="output",
            alias="c",
            inputs=["b:Load.v"],
            outputs=["got"],
            source="got = v\n",
        )
    )
    dag.add_edge(DAGEdge("b::0", "v", "c::0", "b:Load.v"))

    await Executor(dag, bus).run_pipeline()
    # c references b's Load (99), not a's (10).
    assert bus.get("c::0", "got").value == 99


async def test_fanout_branches_get_isolated_copies(bus: DataBus) -> None:
    # One source fans out to two consumers; one mutates its input in place.
    # The other branch must compute against an untouched copy.
    dag = DAG()
    dag.add_node(
        DAGNode(id="src", name="Src", tag="input", outputs=["rows"], source="rows = [1, 2, 3]\n")
    )
    dag.add_node(
        DAGNode(
            id="mut",
            name="Mut",
            tag="transform",
            inputs=["Src.rows"],
            outputs=["n"],
            source="rows.append(99)\nn = len(rows)\n",
        )
    )
    dag.add_node(
        DAGNode(
            id="pure",
            name="Pure",
            tag="transform",
            inputs=["Src.rows"],
            outputs=["n"],
            source="n = len(rows)\n",
        )
    )
    dag.add_edge(DAGEdge("src", "rows", "mut", "Src.rows"))
    dag.add_edge(DAGEdge("src", "rows", "pure", "Src.rows"))

    await Executor(dag, bus).run_pipeline()
    assert bus.get("mut", "n").value == 4  # mutated branch saw its append
    assert bus.get("pure", "n").value == 3  # sibling branch unaffected
