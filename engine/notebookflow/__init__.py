"""NotebookFlow execution engine.

Top-level package. Submodules:

* ``core`` — DAG construction, pipeline execution, data bus, triggers.
* ``nodes`` — built-in node implementations.
* ``protocol`` — extension protocol for third-party node packages.
* ``llm`` — LLM-assisted pipeline authoring, code synthesis, explanation.
* ``server`` — FastAPI + WebSocket entry point used by all platform adapters.
"""

__version__ = "0.0.0"
