"""Tests for the synchronous executor."""

from __future__ import annotations

import pandas as pd
import pytest

from notebookflow.core.dag import DAG, DAGEdge, DAGNode
from notebookflow.core.databus import DataBus
from notebookflow.core.executor import Executor


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
