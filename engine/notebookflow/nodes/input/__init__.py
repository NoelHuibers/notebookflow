"""Input nodes: produce data from external sources (CSV, Parquet, HTTP, etc.)."""

from notebookflow.protocol.registry import Registry


def register_all(_registry: Registry) -> None:
    # TODO: register ParseCSV, ParseParquet, HTTPGet, ...
    raise NotImplementedError
