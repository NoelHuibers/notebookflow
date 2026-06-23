"""Tests for the TriggerManager (file_watch / cron / webhook / manual)."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from notebookflow.core.triggers import Trigger, TriggerFiring, TriggerManager


async def _gather_fired(manager: TriggerManager) -> list[tuple[Trigger, TriggerFiring]]:
    """Helper that records every firing into a list via on_fire."""
    captured: list[tuple[Trigger, TriggerFiring]] = []

    async def on_fire(trigger: Trigger, firing: TriggerFiring) -> None:
        captured.append((trigger, firing))

    manager.on_fire(on_fire)
    return captured


# ---------------------------------------------------------------------------
# Registry + lifecycle
# ---------------------------------------------------------------------------


async def test_register_then_get_and_list() -> None:
    manager = TriggerManager()
    trigger = Trigger(id="t1", kind="manual", pipeline_id="p1")
    manager.register(trigger)
    assert manager.get("t1") is trigger
    assert manager.list_triggers() == [trigger]
    await manager.shutdown()


async def test_duplicate_id_raises() -> None:
    manager = TriggerManager()
    manager.register(Trigger(id="t1", kind="manual", pipeline_id="p1"))
    with pytest.raises(ValueError, match="already registered"):
        manager.register(Trigger(id="t1", kind="manual", pipeline_id="p2"))
    await manager.shutdown()


async def test_unknown_kind_raises() -> None:
    from typing import cast

    from notebookflow.core.triggers import TriggerKind

    manager = TriggerManager()
    with pytest.raises(ValueError, match="Unknown trigger kind"):
        manager.register(Trigger(id="t1", kind=cast("TriggerKind", "bogus"), pipeline_id="p1"))


async def test_get_unknown_raises_keyerror() -> None:
    manager = TriggerManager()
    with pytest.raises(KeyError):
        manager.get("nope")


async def test_unregister_removes_trigger_and_cancels_task() -> None:
    manager = TriggerManager()
    manager.register(
        Trigger(id="t1", kind="cron", pipeline_id="p1", config={"expression": "* * * * *"}),
    )
    # cron registration spawns a background task; unregistering must cancel it.
    assert "t1" in manager._tasks  # noqa: SLF001 - test inspecting internal task table
    await manager.unregister("t1")
    assert manager.list_triggers() == []
    assert "t1" not in manager._tasks  # noqa: SLF001


async def test_unregister_unknown_raises() -> None:
    manager = TriggerManager()
    with pytest.raises(KeyError):
        await manager.unregister("ghost")


async def test_shutdown_cancels_all_watcher_tasks() -> None:
    manager = TriggerManager()
    manager.register(
        Trigger(id="a", kind="cron", pipeline_id="p", config={"expression": "* * * * *"}),
    )
    manager.register(
        Trigger(id="b", kind="cron", pipeline_id="p", config={"expression": "* * * * *"}),
    )
    await manager.shutdown()
    assert manager.list_triggers() == []


# ---------------------------------------------------------------------------
# Firing semantics
# ---------------------------------------------------------------------------


async def test_fire_invokes_callback_and_records_firing() -> None:
    manager = TriggerManager()
    captured = await _gather_fired(manager)
    trigger = Trigger(id="t1", kind="manual", pipeline_id="p1")
    manager.register(trigger)

    firing = await manager.fire("t1", payload={"source": "manual"})

    assert len(captured) == 1
    assert captured[0][0] is trigger
    assert captured[0][1].trigger_id == "t1"
    assert captured[0][1].payload == {"source": "manual"}
    assert manager.firings() == [firing]


async def test_fire_records_history_filtered_per_trigger() -> None:
    manager = TriggerManager()
    await _gather_fired(manager)
    manager.register(Trigger(id="a", kind="manual", pipeline_id="p"))
    manager.register(Trigger(id="b", kind="manual", pipeline_id="p"))

    await manager.fire("a")
    await manager.fire("b")
    await manager.fire("a")

    history_a = manager.firings("a")
    history_b = manager.firings("b")
    assert [f.trigger_id for f in history_a] == ["a", "a"]
    assert [f.trigger_id for f in history_b] == ["b"]


async def test_fire_caps_history_at_max_firings() -> None:
    manager = TriggerManager(max_firings=3)
    manager.register(Trigger(id="t1", kind="manual", pipeline_id="p"))
    for _ in range(5):
        await manager.fire("t1")
    assert len(manager.firings()) == 3


async def test_fire_swallows_callback_exception() -> None:
    manager = TriggerManager()

    async def broken(_trigger: Trigger, _firing: TriggerFiring) -> None:
        raise RuntimeError("kaboom")

    manager.on_fire(broken)
    manager.register(Trigger(id="t1", kind="manual", pipeline_id="p"))
    # Should not raise -- the manager logs and moves on.
    await manager.fire("t1")
    assert len(manager.firings()) == 1


async def test_fire_unknown_raises() -> None:
    manager = TriggerManager()
    with pytest.raises(KeyError):
        await manager.fire("nope")


# ---------------------------------------------------------------------------
# file_watch trigger (uses watchfiles awatch)
# ---------------------------------------------------------------------------


async def test_file_watch_fires_on_directory_change(tmp_path: Path) -> None:
    manager = TriggerManager()
    captured = await _gather_fired(manager)
    manager.register(
        Trigger(
            id="fs",
            kind="file_watch",
            pipeline_id="p",
            config={"paths": [str(tmp_path)]},
        ),
    )
    # Give watchfiles a beat to subscribe before mutating the directory.
    await asyncio.sleep(0.2)
    (tmp_path / "hello.txt").write_text("hi")

    async def wait_for_firing() -> None:
        while not captured:
            await asyncio.sleep(0.05)

    try:
        await asyncio.wait_for(wait_for_firing(), timeout=5.0)
    finally:
        await manager.shutdown()
    assert captured[0][0].id == "fs"
    payload = captured[0][1].payload
    assert "changes" in payload
    assert any("hello.txt" in change["path"] for change in payload["changes"])


async def test_file_watch_with_no_paths_exits_quietly(caplog: pytest.LogCaptureFixture) -> None:
    manager = TriggerManager()
    manager.register(Trigger(id="fs", kind="file_watch", pipeline_id="p", config={"paths": []}))
    # Give the task a moment to log + exit; then shut down cleanly.
    await asyncio.sleep(0.05)
    await manager.shutdown()
    assert "no paths" in caplog.text


# ---------------------------------------------------------------------------
# cron trigger (uses croniter)
# ---------------------------------------------------------------------------


async def test_cron_fires_on_schedule(monkeypatch: pytest.MonkeyPatch) -> None:
    """Cron uses a real croniter loop; we monkeypatch asyncio.sleep so the loop
    completes in test time but still exercises the production path."""
    manager = TriggerManager()
    captured = await _gather_fired(manager)

    real_sleep = asyncio.sleep

    async def fast_sleep(seconds: float) -> None:
        # Collapse arbitrary waits to a tiny tick so the loop can fire twice.
        if seconds <= 0:
            return
        await real_sleep(0.01)

    monkeypatch.setattr("notebookflow.core.triggers.asyncio.sleep", fast_sleep)

    manager.register(
        Trigger(
            id="cr",
            kind="cron",
            pipeline_id="p",
            config={"expression": "* * * * *"},
        ),
    )

    async def wait_for_two() -> None:
        while len(captured) < 2:
            await real_sleep(0.01)

    try:
        await asyncio.wait_for(wait_for_two(), timeout=5.0)
    finally:
        await manager.shutdown()
    assert len(captured) >= 2
    assert all(firing[1].trigger_id == "cr" for firing in captured)
    assert all("scheduled" in firing[1].payload for firing in captured)


async def test_cron_with_invalid_expression_exits_quietly(
    caplog: pytest.LogCaptureFixture,
) -> None:
    manager = TriggerManager()
    manager.register(
        Trigger(id="cr", kind="cron", pipeline_id="p", config={"expression": "not a cron"}),
    )
    await asyncio.sleep(0.05)
    await manager.shutdown()
    assert "invalid expression" in caplog.text


async def test_cron_with_missing_expression_exits_quietly(
    caplog: pytest.LogCaptureFixture,
) -> None:
    manager = TriggerManager()
    manager.register(Trigger(id="cr", kind="cron", pipeline_id="p", config={}))
    await asyncio.sleep(0.05)
    await manager.shutdown()
    assert "no expression" in caplog.text


# ---------------------------------------------------------------------------
# Webhook trigger (no background task; fires only when host calls fire)
# ---------------------------------------------------------------------------


async def test_webhook_trigger_has_no_background_task() -> None:
    manager = TriggerManager()
    manager.register(Trigger(id="wh", kind="webhook", pipeline_id="p"))
    assert "wh" not in manager._tasks  # noqa: SLF001
    await manager.shutdown()


async def test_webhook_fires_when_explicitly_invoked() -> None:
    manager = TriggerManager()
    captured = await _gather_fired(manager)
    manager.register(Trigger(id="wh", kind="webhook", pipeline_id="p"))
    await manager.fire("wh", payload={"body": {"event": "push"}})
    assert len(captured) == 1
    assert captured[0][1].payload == {"body": {"event": "push"}}
