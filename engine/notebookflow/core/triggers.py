"""Trigger system: fires pipelines on manual / file_watch / cron / webhook.

The TriggerManager keeps a registry of named triggers and a single async
on_fire callback the host wires up (typically to run the matching pipeline
through the existing executor). file_watch and cron triggers each own an
asyncio.Task that watches the filesystem or sleeps until the next cron tick
and fires the callback when the trigger fires; webhook + manual triggers
have no background task and fire only when the host explicitly calls
TriggerManager.fire(trigger_id, payload).

A bounded ring buffer of recent firings is kept so observability surfaces
(server endpoint, canvas sidebar) can show what fired and when without
forcing every host to wire its own listener.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

logger = logging.getLogger(__name__)

TriggerKind = Literal["manual", "file_watch", "cron", "webhook"]
_KNOWN_KINDS: frozenset[str] = frozenset(("manual", "file_watch", "cron", "webhook"))

_MAX_FIRINGS = 100


@dataclass(slots=True)
class Trigger:
    """Static description of a registered trigger.

    ``kind``-specific config keys:
        file_watch: {"paths": [str, ...]}        - directories or files to watch
        cron:       {"expression": "*/5 * * * *"} - standard 5-field cron expr
        webhook:    {}                             - fires externally via fire()
        manual:     {}                             - fires externally via fire()
    """

    id: str
    kind: TriggerKind
    pipeline_id: str
    config: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class TriggerFiring:
    trigger_id: str
    fired_at: float  # unix timestamp
    payload: dict[str, Any] = field(default_factory=dict)


TriggerCallback = Callable[[Trigger, TriggerFiring], Awaitable[None]]


class TriggerManager:
    def __init__(self, *, max_firings: int = _MAX_FIRINGS) -> None:
        self._triggers: dict[str, Trigger] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._callback: TriggerCallback | None = None
        self._firings: list[TriggerFiring] = []
        self._max_firings = max_firings

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def on_fire(self, callback: TriggerCallback) -> None:
        """Set the single host callback awaited on every firing.

        The callback receives the Trigger that fired plus the TriggerFiring
        record. Exceptions raised inside the callback are logged but do not
        unregister the trigger -- one bad pipeline run shouldn't kill the
        watch loop.
        """
        self._callback = callback

    def register(self, trigger: Trigger) -> None:
        if trigger.id in self._triggers:
            raise ValueError(f"Trigger id {trigger.id!r} already registered")
        if trigger.kind not in _KNOWN_KINDS:
            raise ValueError(f"Unknown trigger kind: {trigger.kind!r}")
        self._triggers[trigger.id] = trigger
        if trigger.kind == "file_watch":
            self._tasks[trigger.id] = asyncio.create_task(
                self._watch_files(trigger),
                name=f"trigger-file_watch-{trigger.id}",
            )
        elif trigger.kind == "cron":
            self._tasks[trigger.id] = asyncio.create_task(
                self._watch_cron(trigger),
                name=f"trigger-cron-{trigger.id}",
            )
        # manual + webhook live without a watcher task; the host calls fire().

    async def unregister(self, trigger_id: str) -> None:
        if trigger_id not in self._triggers:
            raise KeyError(trigger_id)
        task = self._tasks.pop(trigger_id, None)
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await task
        self._triggers.pop(trigger_id, None)

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def get(self, trigger_id: str) -> Trigger:
        if trigger_id not in self._triggers:
            raise KeyError(trigger_id)
        return self._triggers[trigger_id]

    def list_triggers(self) -> list[Trigger]:
        """All registered triggers in registration order."""
        return list(self._triggers.values())

    def firings(self, trigger_id: str | None = None) -> list[TriggerFiring]:
        """Ring buffer of recent firings, optionally filtered to one trigger."""
        if trigger_id is None:
            return list(self._firings)
        return [f for f in self._firings if f.trigger_id == trigger_id]

    # ------------------------------------------------------------------
    # Firing
    # ------------------------------------------------------------------

    async def fire(
        self,
        trigger_id: str,
        payload: dict[str, Any] | None = None,
    ) -> TriggerFiring:
        """Record + dispatch a firing. Returns the TriggerFiring entry."""
        trigger = self.get(trigger_id)
        firing = TriggerFiring(
            trigger_id=trigger_id,
            fired_at=time.time(),
            payload=payload or {},
        )
        self._firings.append(firing)
        if len(self._firings) > self._max_firings:
            self._firings = self._firings[-self._max_firings :]
        if self._callback is not None:
            try:
                await self._callback(trigger, firing)
            except Exception:
                logger.exception("TriggerManager.on_fire callback raised for %r", trigger_id)
        return firing

    async def shutdown(self) -> None:
        """Cancel every watcher task. Safe to call multiple times."""
        for trigger_id in list(self._tasks.keys()):
            with suppress(KeyError):
                await self.unregister(trigger_id)

    # ------------------------------------------------------------------
    # Watcher coroutines
    # ------------------------------------------------------------------

    async def _watch_files(self, trigger: Trigger) -> None:
        # Import inside the coroutine so the import cost (and watchfiles'
        # native module load) only lands when somebody actually uses a
        # file_watch trigger.
        from watchfiles import awatch  # noqa: PLC0415

        raw_paths = trigger.config.get("paths", [])
        if not isinstance(raw_paths, list) or not raw_paths:
            logger.warning("file_watch trigger %r has no paths; exiting", trigger.id)
            return
        paths = [str(p) for p in raw_paths]
        try:
            async for changes in awatch(*paths):
                await self.fire(
                    trigger.id,
                    {
                        "changes": [
                            {"type": _change_name(change), "path": str(path)}
                            for change, path in changes
                        ],
                    },
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("file_watch trigger %r crashed", trigger.id)

    async def _watch_cron(self, trigger: Trigger) -> None:
        from croniter import croniter  # noqa: PLC0415

        expression = trigger.config.get("expression")
        if not isinstance(expression, str) or expression.strip() == "":
            logger.warning("cron trigger %r has no expression; exiting", trigger.id)
            return
        try:
            iterator = croniter(expression, datetime.now())
        except (ValueError, KeyError):
            logger.exception(
                "cron trigger %r has invalid expression %r",
                trigger.id,
                expression,
            )
            return
        try:
            while True:
                next_fire = iterator.get_next(datetime)
                sleep_s = (next_fire - datetime.now()).total_seconds()
                if sleep_s > 0:
                    await asyncio.sleep(sleep_s)
                await self.fire(trigger.id, {"scheduled": next_fire.isoformat()})
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("cron trigger %r crashed", trigger.id)


def _change_name(change: Any) -> str:
    """watchfiles.Change is an IntEnum; ``.name`` is the textual form."""
    name = getattr(change, "name", None)
    if isinstance(name, str):
        return name.lower()
    return str(change)
