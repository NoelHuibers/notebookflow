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
import json
import logging
import time
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, cast

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
    pipeline: dict[str, Any] | None = None
    owner_id: str | None = None
    webhook_token: str | None = None


@dataclass(slots=True)
class TriggerFiring:
    trigger_id: str
    fired_at: float  # unix timestamp
    payload: dict[str, Any] = field(default_factory=dict)
    owner_id: str | None = None


TriggerCallback = Callable[[Trigger, TriggerFiring], Awaitable[None]]


class TriggerManager:
    def __init__(
        self,
        *,
        max_firings: int = _MAX_FIRINGS,
        state_path: Path | None = None,
    ) -> None:
        self._triggers: dict[tuple[str | None, str], Trigger] = {}
        self._tasks: dict[tuple[str | None, str], asyncio.Task[None]] = {}
        self._callback: TriggerCallback | None = None
        self._firings: list[TriggerFiring] = []
        self._max_firings = max_firings
        self._state_path = state_path
        self._restore()

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
        key = self._key(trigger.id, trigger.owner_id)
        if key in self._triggers:
            raise ValueError(f"Trigger id {trigger.id!r} already registered")
        if trigger.kind not in _KNOWN_KINDS:
            raise ValueError(f"Unknown trigger kind: {trigger.kind!r}")
        self._triggers[key] = trigger
        self._start_watcher(trigger)
        self._persist()

    def _start_watcher(self, trigger: Trigger) -> None:
        key = self._key(trigger.id, trigger.owner_id)
        if trigger.kind == "file_watch":
            self._tasks[key] = asyncio.create_task(
                self._watch_files(trigger),
                name=f"trigger-file_watch-{trigger.id}",
            )
        elif trigger.kind == "cron":
            self._tasks[key] = asyncio.create_task(
                self._watch_cron(trigger),
                name=f"trigger-cron-{trigger.id}",
            )
        # manual + webhook live without a watcher task; the host calls fire().

    async def unregister(self, trigger_id: str, *, owner_id: str | None = None) -> None:
        key = self._key(trigger_id, owner_id)
        if key not in self._triggers:
            raise KeyError(trigger_id)
        task = self._tasks.pop(key, None)
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await task
        self._triggers.pop(key, None)
        self._firings = [
            firing
            for firing in self._firings
            if not (firing.trigger_id == trigger_id and firing.owner_id == owner_id)
        ]
        self._persist()

    async def unregister_owner(self, owner_id: str) -> None:
        """Remove all trigger state owned by one authenticated tenant."""
        for trigger in list(self.list_triggers(owner_id=owner_id)):
            await self.unregister(trigger.id, owner_id=owner_id)

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def get(self, trigger_id: str, *, owner_id: str | None = None) -> Trigger:
        key = self._key(trigger_id, owner_id)
        if key not in self._triggers:
            raise KeyError(trigger_id)
        return self._triggers[key]

    def list_triggers(self, *, owner_id: str | None = None) -> list[Trigger]:
        """All triggers for one tenant, in registration order."""
        return [trigger for trigger in self._triggers.values() if trigger.owner_id == owner_id]

    def firings(
        self,
        trigger_id: str | None = None,
        *,
        owner_id: str | None = None,
    ) -> list[TriggerFiring]:
        """Ring buffer of recent firings, optionally filtered to one trigger."""
        if trigger_id is None:
            return [firing for firing in self._firings if firing.owner_id == owner_id]
        return [
            firing
            for firing in self._firings
            if firing.trigger_id == trigger_id and firing.owner_id == owner_id
        ]

    def get_by_webhook_token(self, token: str) -> Trigger:
        """Resolve an opaque webhook capability token to its trigger."""
        if token == "":
            raise KeyError(token)
        for trigger in self._triggers.values():
            if trigger.kind == "webhook" and trigger.webhook_token == token:
                return trigger
        raise KeyError(token)

    # ------------------------------------------------------------------
    # Firing
    # ------------------------------------------------------------------

    async def fire(
        self,
        trigger_id: str,
        payload: dict[str, Any] | None = None,
        *,
        owner_id: str | None = None,
    ) -> TriggerFiring:
        """Record + dispatch a firing. Returns the TriggerFiring entry."""
        trigger = self.get(trigger_id, owner_id=owner_id)
        firing = TriggerFiring(
            trigger_id=trigger_id,
            fired_at=time.time(),
            payload=payload or {},
            owner_id=owner_id,
        )
        self._firings.append(firing)
        owned = [f for f in self._firings if f.owner_id == owner_id]
        if len(owned) > self._max_firings:
            oldest = next(
                index
                for index, candidate in enumerate(self._firings)
                if candidate.owner_id == owner_id
            )
            self._firings.pop(oldest)
        self._persist()
        if self._callback is not None:
            try:
                await self._callback(trigger, firing)
            except Exception:
                logger.exception("TriggerManager.on_fire callback raised for %r", trigger_id)
        return firing

    async def shutdown(self) -> None:
        """Cancel watcher tasks without deleting the persisted registrations."""
        tasks = list(self._tasks.values())
        self._tasks.clear()
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError, Exception):
                await task

    @staticmethod
    def _key(trigger_id: str, owner_id: str | None) -> tuple[str | None, str]:
        return owner_id, trigger_id

    def _persist(self) -> None:
        if self._state_path is None:
            return
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 1,
            "triggers": [asdict(trigger) for trigger in self._triggers.values()],
            "firings": [asdict(firing) for firing in self._firings],
        }
        temporary = self._state_path.with_suffix(f"{self._state_path.suffix}.tmp")
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        temporary.replace(self._state_path)

    def _restore(self) -> None:
        if self._state_path is None or not self._state_path.is_file():
            return
        try:
            payload = json.loads(self._state_path.read_text(encoding="utf-8"))
            raw_triggers = payload.get("triggers", [])
            raw_firings = payload.get("firings", [])
            if not isinstance(raw_triggers, list) or not isinstance(raw_firings, list):
                raise ValueError("trigger state lists are malformed")
            for raw in raw_triggers:
                if not isinstance(raw, dict):
                    continue
                kind = raw.get("kind")
                if kind not in _KNOWN_KINDS:
                    continue
                trigger = Trigger(
                    id=str(raw["id"]),
                    kind=cast("TriggerKind", kind),
                    pipeline_id=str(raw["pipeline_id"]),
                    config=dict(raw.get("config", {})),
                    pipeline=(
                        dict(raw["pipeline"]) if isinstance(raw.get("pipeline"), dict) else None
                    ),
                    owner_id=raw.get("owner_id") if isinstance(raw.get("owner_id"), str) else None,
                    webhook_token=(
                        raw.get("webhook_token")
                        if isinstance(raw.get("webhook_token"), str)
                        else None
                    ),
                )
                self._triggers[self._key(trigger.id, trigger.owner_id)] = trigger
                self._start_watcher(trigger)
            for raw in raw_firings:
                if not isinstance(raw, dict):
                    continue
                payload_value = raw.get("payload", {})
                self._firings.append(
                    TriggerFiring(
                        trigger_id=str(raw["trigger_id"]),
                        fired_at=float(raw["fired_at"]),
                        payload=dict(payload_value) if isinstance(payload_value, dict) else {},
                        owner_id=(
                            raw.get("owner_id") if isinstance(raw.get("owner_id"), str) else None
                        ),
                    )
                )
        except Exception:
            logger.exception("Failed to restore trigger state from %s", self._state_path)

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
                    owner_id=trigger.owner_id,
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
                await self.fire(
                    trigger.id,
                    {"scheduled": next_fire.isoformat()},
                    owner_id=trigger.owner_id,
                )
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
