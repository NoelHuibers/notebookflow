"""IO nodes: side-effecting integrations (databases, queues, webhooks)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from notebookflow.protocol.manifest import NodeConfigField, NodeConfigOption, NodeManifest, NodePort

if TYPE_CHECKING:
    from notebookflow.protocol.registry import Registry


SQL_QUERY = NodeManifest(
    id="notebookflow.sql_query",
    name="SQL Query",
    tag="io",
    version="0.1.0",
    description=(
        "Run a SQL query against a SQLAlchemy connection string and return the "
        "result as a pandas DataFrame."
    ),
    inputs=[],
    outputs=[NodePort(name="df", type="dataframe")],
    template=(
        "import pandas as pd\n"
        "import sqlalchemy as sa\n"
        "\n"
        "engine = sa.create_engine({connection_literal})\n"
        "with engine.connect() as conn:\n"
        "    {primary_output} = pd.read_sql({query_literal}, conn)\n"
    ),
    config_fields=[
        NodeConfigField(
            key="connection",
            label="Connection string",
            description=(
                "SQLAlchemy URL. Examples: sqlite:///data.db, "
                "postgresql+psycopg://user:pass@host/db."
            ),
            placeholder="sqlite:///data.db",
            required=True,
            default_value="sqlite:///data.db",
        ),
        NodeConfigField(
            key="query",
            label="SQL query",
            kind="textarea",
            description=(
                "SQL executed against the connection. Result columns become DataFrame columns."
            ),
            placeholder="SELECT * FROM users LIMIT 100",
            required=True,
            default_value="SELECT 1 AS one",
        ),
    ],
)


KAFKA_PRODUCE = NodeManifest(
    id="notebookflow.kafka_produce",
    name="Kafka Produce",
    tag="io",
    version="0.1.0",
    description=(
        "Stream rows of a DataFrame to a Kafka topic, one JSON message per row."
    ),
    inputs=[NodePort(name="df", type="dataframe")],
    outputs=[NodePort(name="count", type="any")],
    template=(
        "import json\n"
        "from kafka import KafkaProducer\n"
        "\n"
        "producer = KafkaProducer(\n"
        "    bootstrap_servers=[s.strip() for s in {brokers_literal}.split(',') if s.strip()],\n"
        "    value_serializer=lambda v: json.dumps(v).encode('utf-8'),\n"
        ")\n"
        "{primary_output} = 0\n"
        "for record in {primary_input}.to_dict(orient='records'):\n"
        "    producer.send({topic_literal}, value=record)\n"
        "    {primary_output} += 1\n"
        "producer.flush()\n"
        "producer.close()\n"
    ),
    config_fields=[
        NodeConfigField(
            key="brokers",
            label="Bootstrap servers",
            description=(
                "Comma-separated host:port list passed to "
                "KafkaProducer(bootstrap_servers=...)."
            ),
            placeholder="localhost:9092",
            required=True,
            default_value="localhost:9092",
        ),
        NodeConfigField(
            key="topic",
            label="Topic",
            description="Kafka topic to publish to.",
            placeholder="events.notebookflow",
            required=True,
            default_value="events.notebookflow",
        ),
    ],
)


WEBHOOK_POST = NodeManifest(
    id="notebookflow.webhook_post",
    name="Webhook POST",
    tag="io",
    version="0.1.0",
    description="POST a JSON payload (typically built from upstream data) to an HTTP endpoint.",
    inputs=[NodePort(name="payload", type="json")],
    outputs=[NodePort(name="response", type="any")],
    template=(
        "import json\n"
        "from urllib.request import Request, urlopen\n"
        "\n"
        "body = json.dumps({primary_input}).encode('utf-8')\n"
        "req = Request(\n"
        "    {url_literal},\n"
        "    data=body,\n"
        "    headers={{'Content-Type': 'application/json'}},\n"
        "    method={method_literal},\n"
        ")\n"
        "with urlopen(req, timeout=30) as resp:\n"
        "    {primary_output} = resp.read().decode('utf-8')\n"
    ),
    config_fields=[
        NodeConfigField(
            key="url",
            label="Endpoint URL",
            description="HTTP(S) URL receiving the JSON-encoded payload.",
            placeholder="https://example.com/webhook",
            required=True,
            default_value="https://example.com/webhook",
        ),
        NodeConfigField(
            key="method",
            label="HTTP method",
            kind="select",
            description="HTTP verb used for the request.",
            required=True,
            default_value="POST",
            options=[
                NodeConfigOption(value="POST", label="POST"),
                NodeConfigOption(value="PUT", label="PUT"),
                NodeConfigOption(value="PATCH", label="PATCH"),
            ],
        ),
    ],
)


def register_all(registry: Registry) -> None:
    registry.register(SQL_QUERY)
    registry.register(KAFKA_PRODUCE)
    registry.register(WEBHOOK_POST)
