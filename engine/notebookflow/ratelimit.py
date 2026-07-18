"""Dependency-free rate limiting for the FastAPI surface (#82).

A sliding-window limiter keyed by ``(identity, bucket)``:

- **identity** — the authenticated subject (JWT ``sub``) when the request
  carries a valid bearer token, else the client IP (honouring Fly's
  ``Fly-Client-IP`` header so limits apply to the real client, not the edge
  proxy).
- **bucket** — a per-endpoint label so, say, LLM calls and uploads don't
  share a budget.

In-memory on purpose: the engine is a single long-lived process (Fly machine
or local), so no external store is needed. Limits reset on restart, which is
acceptable for abuse/runaway-cost protection.

The FastAPI hook is :func:`rate_limited`, a dependency factory::

    @app.post("/llm/ask", dependencies=[Depends(require_auth),
                                        Depends(rate_limited("llm-ask", 10, 60))])

Over-limit requests get a 429 with a ``Retry-After`` header. The time source
is injectable so tests can drive the window deterministically.
"""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from collections.abc import Callable

from fastapi import HTTPException, Request

from notebookflow.auth import AuthError, auth_configured, authenticate


class RateLimiter:
    """Sliding-window request limiter keyed by ``(identity, bucket)``.

    ``clock`` defaults to ``time.monotonic``; inject a fake in tests. Thread-
    safe: FastAPI may resolve dependencies for sync endpoints in a thread pool.
    """

    def __init__(self, clock: Callable[[], float] | None = None) -> None:
        self._clock: Callable[[], float] = clock if clock is not None else time.monotonic
        self._hits: dict[tuple[str, str], deque[float]] = {}
        self._lock = threading.Lock()

    def check(
        self, identity: str, bucket: str, max_requests: int, window_seconds: float
    ) -> float | None:
        """Record a hit and decide it.

        Returns ``None`` when the request is allowed, else the number of
        seconds until the oldest in-window hit expires (i.e. a ``Retry-After``
        value). Denied requests are not recorded, so hammering while limited
        doesn't extend the wait.
        """
        now = self._clock()
        with self._lock:
            hits = self._hits.setdefault((identity, bucket), deque())
            cutoff = now - window_seconds
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) >= max_requests:
                return hits[0] + window_seconds - now
            hits.append(now)
            return None


def client_ip(request: Request) -> str:
    """Best-available client address. Fly terminates TLS at its edge and puts
    the real client in ``Fly-Client-IP``; otherwise use the socket peer."""
    fly_ip = request.headers.get("Fly-Client-IP", "").strip()
    if fly_ip != "":
        return fly_ip
    return request.client.host if request.client is not None else "unknown"


def request_identity(request: Request) -> str:
    """Rate-limit identity: authenticated subject when available, else IP.

    Best-effort — an invalid token just falls back to the IP bucket (the
    endpoint's own ``require_auth`` still rejects it with 401). Static-secret
    auth has no per-user subject, so those requests are keyed by IP too.
    """
    if auth_configured():
        header = request.headers.get("Authorization", "")
        if header.startswith("Bearer "):
            try:
                principal = authenticate(header.removeprefix("Bearer ").strip())
            except AuthError:
                principal = None
            if principal is not None and principal.user_id:
                return f"user:{principal.user_id}"
    return f"ip:{client_ip(request)}"


# Process-wide limiter shared by every endpoint dependency.
_limiter = RateLimiter()


def rate_limited(
    bucket: str,
    max_requests: int,
    window_seconds: float,
    limiter: RateLimiter | None = None,
) -> Callable[[Request], None]:
    """FastAPI dependency factory enforcing ``max_requests`` per rolling
    ``window_seconds`` for ``bucket``, per identity. Raises 429 with a
    ``Retry-After`` header when the budget is exhausted. ``limiter`` is
    injectable for tests; defaults to the process-wide instance."""

    active = limiter if limiter is not None else _limiter

    def dependency(request: Request) -> None:
        retry_after = active.check(request_identity(request), bucket, max_requests, window_seconds)
        if retry_after is not None:
            raise HTTPException(
                status_code=429,
                detail=f"rate limit exceeded for {bucket}: "
                f"{max_requests} requests per {window_seconds:g}s",
                headers={"Retry-After": str(max(1, math.ceil(retry_after)))},
            )

    return dependency
