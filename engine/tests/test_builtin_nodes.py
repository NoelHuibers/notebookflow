"""Tests for the built-in node manifests."""

from __future__ import annotations

from notebookflow.nodes import register as register_builtins
from notebookflow.nodes.ai import AI_PYTHON_TRANSFORM, CLASSIFY, EMBED, LLM_GENERATE
from notebookflow.nodes.input import PARSE_CSV
from notebookflow.nodes.io import KAFKA_PRODUCE, SQL_QUERY, WEBHOOK_POST
from notebookflow.nodes.output import PLOT_CHART
from notebookflow.nodes.transform import FILTER_ROWS
from notebookflow.protocol.registry import Registry

_EXPECTED_IDS = {
    "notebookflow.ai_python_transform",
    "notebookflow.llm_generate",
    "notebookflow.embed",
    "notebookflow.classify",
    "notebookflow.parse_csv",
    "notebookflow.filter_rows",
    "notebookflow.plot_chart",
    "notebookflow.sql_query",
    "notebookflow.kafka_produce",
    "notebookflow.webhook_post",
}


def test_register_loads_builtin_manifests() -> None:
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
    assert PARSE_CSV.config_fields[0].key == "path"


def test_filter_rows_manifest_shape() -> None:
    assert FILTER_ROWS.tag == "transform"
    assert FILTER_ROWS.inputs[0].name == "df"
    assert FILTER_ROWS.outputs[0].name == "df"
    assert FILTER_ROWS.template.strip() != ""
    assert FILTER_ROWS.config_fields[0].key == "condition"


def test_plot_chart_manifest_shape() -> None:
    assert PLOT_CHART.tag == "output"
    assert PLOT_CHART.inputs[0].name == "df"
    assert PLOT_CHART.outputs == []
    assert "plot" in PLOT_CHART.template
    assert {field.key for field in PLOT_CHART.config_fields} == {
        "kind",
        "x_column",
        "y_column",
        "title",
    }


def test_ai_python_transform_manifest_shape() -> None:
    assert AI_PYTHON_TRANSFORM.tag == "ai"
    assert AI_PYTHON_TRANSFORM.generation_mode == "llm"
    assert AI_PYTHON_TRANSFORM.outputs[0].name == "result"
    assert AI_PYTHON_TRANSFORM.config_fields[0].kind == "textarea"


def test_sql_query_manifest_shape() -> None:
    assert SQL_QUERY.tag == "io"
    assert SQL_QUERY.inputs == []
    assert SQL_QUERY.outputs[0].name == "df"
    assert SQL_QUERY.outputs[0].type == "dataframe"
    assert "sqlalchemy" in SQL_QUERY.template
    assert "read_sql" in SQL_QUERY.template
    assert {f.key for f in SQL_QUERY.config_fields} == {"connection", "query"}
    query_field = next(f for f in SQL_QUERY.config_fields if f.key == "query")
    assert query_field.kind == "textarea"


def test_kafka_produce_manifest_shape() -> None:
    assert KAFKA_PRODUCE.tag == "io"
    assert KAFKA_PRODUCE.inputs[0].name == "df"
    assert KAFKA_PRODUCE.outputs[0].name == "count"
    assert "KafkaProducer" in KAFKA_PRODUCE.template
    assert "producer.send" in KAFKA_PRODUCE.template
    assert {f.key for f in KAFKA_PRODUCE.config_fields} == {"brokers", "topic"}


def test_webhook_post_manifest_shape() -> None:
    assert WEBHOOK_POST.tag == "io"
    assert WEBHOOK_POST.inputs[0].name == "payload"
    assert WEBHOOK_POST.outputs[0].name == "response"
    assert "urlopen" in WEBHOOK_POST.template
    method_field = next(f for f in WEBHOOK_POST.config_fields if f.key == "method")
    assert method_field.kind == "select"
    assert {opt.value for opt in method_field.options} == {"POST", "PUT", "PATCH"}


def test_llm_generate_manifest_shape() -> None:
    assert LLM_GENERATE.tag == "ai"
    assert LLM_GENERATE.outputs[0].name == "text"
    assert "anthropic" in LLM_GENERATE.template
    assert "messages.create" in LLM_GENERATE.template
    assert {f.key for f in LLM_GENERATE.config_fields} == {"model", "prompt", "max_tokens"}


def test_embed_manifest_shape() -> None:
    assert EMBED.tag == "ai"
    assert EMBED.outputs[0].name == "vectors"
    assert "embeddings.create" in EMBED.template
    assert {f.key for f in EMBED.config_fields} == {"model", "seed_text"}


def test_classify_manifest_shape() -> None:
    assert CLASSIFY.tag == "ai"
    assert CLASSIFY.inputs[0].name == "df"
    assert CLASSIFY.outputs[0].name == "df"
    assert "Classify the text into exactly one of:" in CLASSIFY.template
    assert {f.key for f in CLASSIFY.config_fields} == {
        "model",
        "text_column",
        "label_column",
        "labels",
    }


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
