"""Output nodes: send data somewhere terminal (charts, files, dashboards)."""

from notebookflow.protocol.registry import Registry


def register_all(_registry: Registry) -> None:
    # TODO: register PlotChart, WriteParquet, WriteCSV, ...
    raise NotImplementedError
