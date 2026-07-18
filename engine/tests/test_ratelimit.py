"""Tests for the sliding-window rate limiter and its FastAPI integration (#82)."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from notebookflow import ratelimit
from notebookflow.auth import AuthPrincipal
from notebookflow.ratelimit import RateLimiter, rate_limited


class FakeClock:
    """Injectable time source so window expiry is deterministic."""

    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


# ---------------------------------------------------------------------------
# RateLimiter unit behaviour
# ---------------------------------------------------------------------------


def test_allows_up_to_max_then_denies() -> None:
    clock = FakeClock()
    limiter = RateLimiter(clock=clock)
    assert limiter.check("u", "b", 2, 60.0) is None
    assert limiter.check("u", "b", 2, 60.0) is None
    retry = limiter.check("u", "b", 2, 60.0)
    assert retry is not None
    assert retry == pytest.approx(60.0)


def test_window_expiry_frees_budget() -> None:
    clock = FakeClock()
    limiter = RateLimiter(clock=clock)
    assert limiter.check("u", "b", 1, 60.0) is None
    assert limiter.check("u", "b", 1, 60.0) is not None
    clock.advance(61.0)
    assert limiter.check("u", "b", 1, 60.0) is None


def test_retry_after_shrinks_as_time_passes() -> None:
    clock = FakeClock()
    limiter = RateLimiter(clock=clock)
    assert limiter.check("u", "b", 1, 60.0) is None
    clock.advance(45.0)
    retry = limiter.check("u", "b", 1, 60.0)
    assert retry == pytest.approx(15.0)


def test_denied_requests_do_not_extend_the_window() -> None:
    clock = FakeClock()
    limiter = RateLimiter(clock=clock)
    assert limiter.check("u", "b", 1, 60.0) is None
    for _ in range(5):
        clock.advance(10.0)
        assert limiter.check("u", "b", 1, 60.0) is not None
    clock.advance(11.0)  # 61s after the one recorded hit.
    assert limiter.check("u", "b", 1, 60.0) is None


def test_identities_are_isolated() -> None:
    limiter = RateLimiter(clock=FakeClock())
    assert limiter.check("alice", "b", 1, 60.0) is None
    assert limiter.check("alice", "b", 1, 60.0) is not None
    assert limiter.check("bob", "b", 1, 60.0) is None


def test_buckets_are_isolated() -> None:
    limiter = RateLimiter(clock=FakeClock())
    assert limiter.check("u", "llm", 1, 60.0) is None
    assert limiter.check("u", "llm", 1, 60.0) is not None
    assert limiter.check("u", "files", 1, 60.0) is None


# ---------------------------------------------------------------------------
# FastAPI dependency: 429 + Retry-After
# ---------------------------------------------------------------------------


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def client(clock: FakeClock) -> Iterator[TestClient]:
    app = FastAPI()
    limiter = RateLimiter(clock=clock)

    @app.get("/limited", dependencies=[Depends(rate_limited("test", 2, 60.0, limiter=limiter))])
    async def limited() -> dict[str, bool]:
        return {"ok": True}

    with TestClient(app) as test_client:
        yield test_client


def test_endpoint_429_with_retry_after(client: TestClient, clock: FakeClock) -> None:
    assert client.get("/limited").status_code == 200
    assert client.get("/limited").status_code == 200

    limited = client.get("/limited")
    assert limited.status_code == 429
    assert int(limited.headers["Retry-After"]) == 60

    clock.advance(61.0)
    assert client.get("/limited").status_code == 200


def test_endpoint_keys_by_fly_client_ip(client: TestClient) -> None:
    a = {"Fly-Client-IP": "203.0.113.7"}
    b = {"Fly-Client-IP": "198.51.100.9"}
    assert client.get("/limited", headers=a).status_code == 200
    assert client.get("/limited", headers=a).status_code == 200
    assert client.get("/limited", headers=a).status_code == 429
    # A different client IP has its own budget.
    assert client.get("/limited", headers=b).status_code == 200


def test_endpoint_keys_by_auth_subject(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    # Stand in for JWT auth: the bearer token *is* the user id.
    monkeypatch.setattr(ratelimit, "auth_configured", lambda: True)
    monkeypatch.setattr(
        ratelimit, "authenticate", lambda token: AuthPrincipal(user_id=token or None)
    )
    alice = {"Authorization": "Bearer alice"}
    bob = {"Authorization": "Bearer bob"}
    assert client.get("/limited", headers=alice).status_code == 200
    assert client.get("/limited", headers=alice).status_code == 200
    assert client.get("/limited", headers=alice).status_code == 429
    # Same source IP, different authenticated subject: separate budget.
    assert client.get("/limited", headers=bob).status_code == 200
