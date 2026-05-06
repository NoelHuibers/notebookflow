"""IO nodes: side-effecting integrations (databases, queues, webhooks)."""

from notebookflow.protocol.registry import Registry


def register_all(_registry: Registry) -> None:
    # TODO: register SQLQuery, KafkaProduce, WebhookPost, ...
    raise NotImplementedError
