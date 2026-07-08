"""Shared pytest fixtures for the engine core tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from notebookflow.core.dag import DAG, DAGEdge, DAGNode
from notebookflow.core.databus import DataBus


@pytest.fixture
def spill_dir(tmp_path: Path) -> Path:
    """Per-test directory the DataBus is allowed to spill Parquet files to."""
    return tmp_path / "spill"


@pytest.fixture
def bus(spill_dir: Path) -> DataBus:
    return DataBus(spill_dir=spill_dir)


@pytest.fixture
def linear_dag() -> DAG:
    """A → B → C linear pipeline with no cell sources attached."""
    dag = DAG()
    dag.add_node(DAGNode(id="a", name="A", tag="input", outputs=["df"]))
    dag.add_node(DAGNode(id="b", name="B", tag="transform", inputs=["df<-A.df"], outputs=["clean"]))
    dag.add_node(DAGNode(id="c", name="C", tag="output", inputs=["clean<-B.clean"]))
    dag.add_edge(DAGEdge("a", "df", "b", "df<-A.df"))
    dag.add_edge(DAGEdge("b", "clean", "c", "clean<-B.clean"))
    return dag


@pytest.fixture
def runnable_dag() -> DAG:
    """A → B → C pipeline whose nodes have inline source the executor can run."""
    dag = DAG()
    dag.add_node(
        DAGNode(
            id="a",
            name="A",
            tag="input",
            outputs=["df"],
            source="df = [1, 2, 3, 4, 5]\n",
        )
    )
    dag.add_node(
        DAGNode(
            id="b",
            name="B",
            tag="transform",
            inputs=["df<-A.df"],
            outputs=["clean"],
            source="clean = [x for x in df if x % 2 == 1]\n",
        )
    )
    dag.add_node(
        DAGNode(
            id="c",
            name="C",
            tag="output",
            inputs=["clean<-B.clean"],
            outputs=["total"],
            source="total = sum(clean)\n",
        )
    )
    dag.add_edge(DAGEdge("a", "df", "b", "df<-A.df"))
    dag.add_edge(DAGEdge("b", "clean", "c", "clean<-B.clean"))
    return dag
