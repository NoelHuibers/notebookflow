"""Transform nodes: stateless reshaping of data (Filter, GroupBy, Join, ...)."""

from notebookflow.protocol.registry import Registry


def register_all(_registry: Registry) -> None:
    # TODO: register FilterRows, GroupBy, JoinFrames, ...
    raise NotImplementedError
