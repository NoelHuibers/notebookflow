"""Trigger system: starts pipelines on manual run, file watch, cron, or webhook."""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any, Literal

TriggerKind = Literal["manual", "file_watch", "cron", "webhook"]


@dataclass(slots=True)
class Trigger:
    kind: TriggerKind
    pipeline_id: str
    config: dict[str, Any]


TriggerCallback = Callable[[Trigger], Coroutine[Any, Any, None]]


class TriggerManager:
    def __init__(self) -> None:
        self._triggers: dict[str, Trigger] = {}
        self._callback: TriggerCallback | None = None

    def register(self, _trigger: Trigger) -> None:
        # TODO: install handler depending on kind:
        #   - file_watch via watchfiles, cron via croniter loop, webhook via FastAPI route.
        raise NotImplementedError

    def on_fire(self, _cb: TriggerCallback) -> None:
        self._callback = _cb

    async def fire_manual(self, _pipeline_id: str) -> None:
        raise NotImplementedError
