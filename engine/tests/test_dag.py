"""Tests for the DAG builder and Kahn-style topological order."""

from __future__ import annotations

import pytest

from notebookflow.core.dag import DAG, DAGEdge, DAGNode


def test_empty_dag_topological_order_is_empty() -> None:
    assert DAG().topological_order() == []


def test_add_node_then_lookup_round_trip() -> None:
    dag = DAG()
    node = DAGNode(id="a", name="A", tag="input")
    dag.add_node(node)
    assert dag.nodes() == [node]


def test_add_duplicate_node_raises() -> None:
    dag = DAG()
    dag.add_node(DAGNode(id="a", name="A", tag="input"))
    with pytest.raises(ValueError, match="already contains node id"):
        dag.add_node(DAGNode(id="a", name="A again", tag="input"))


def test_add_edge_with_missing_source_raises() -> None:
    dag = DAG()
    dag.add_node(DAGNode(id="b", name="B", tag="transform"))
    with pytest.raises(ValueError, match="source node 'a' not in DAG"):
        dag.add_edge(DAGEdge("a", "df", "b", "df"))


def test_add_edge_with_missing_target_raises() -> None:
    dag = DAG()
    dag.add_node(DAGNode(id="a", name="A", tag="input"))
    with pytest.raises(ValueError, match="target node 'b' not in DAG"):
        dag.add_edge(DAGEdge("a", "df", "b", "df"))


def test_topological_order_of_linear_chain(linear_dag: DAG) -> None:
    order = [n.id for n in linear_dag.topological_order()]
    assert order == ["a", "b", "c"]


def test_topological_order_of_diamond() -> None:
    dag = DAG()
    for nid in ["root", "left", "right", "leaf"]:
        dag.add_node(DAGNode(id=nid, name=nid, tag="transform"))
    dag.add_edge(DAGEdge("root", "x", "left", "x"))
    dag.add_edge(DAGEdge("root", "x", "right", "x"))
    dag.add_edge(DAGEdge("left", "y", "leaf", "y"))
    dag.add_edge(DAGEdge("right", "y", "leaf", "y"))
    order = [n.id for n in dag.topological_order()]
    assert order[0] == "root"
    assert order[-1] == "leaf"
    assert set(order[1:3]) == {"left", "right"}


def test_topological_order_raises_on_cycle() -> None:
    dag = DAG()
    dag.add_node(DAGNode(id="a", name="A", tag="transform"))
    dag.add_node(DAGNode(id="b", name="B", tag="transform"))
    dag.add_edge(DAGEdge("a", "x", "b", "x"))
    dag.add_edge(DAGEdge("b", "y", "a", "y"))
    with pytest.raises(ValueError, match="cycle"):
        dag.topological_order()


def test_upstream_of_returns_transitive_set(linear_dag: DAG) -> None:
    upstream = {n.id for n in linear_dag.upstream_of("c")}
    assert upstream == {"a", "b"}


def test_upstream_of_root_node_is_empty(linear_dag: DAG) -> None:
    assert list(linear_dag.upstream_of("a")) == []


def test_upstream_of_unknown_node_raises(linear_dag: DAG) -> None:
    with pytest.raises(KeyError):
        list(linear_dag.upstream_of("nope"))
