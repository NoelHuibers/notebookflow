"""Request authentication for the engine.

Two mechanisms, both optional, checked in order:

1. **Static shared secret** — ``NOTEBOOKFLOW_AUTH_TOKEN``. The presented bearer
   token must equal the secret. Used for self-host / single-tenant deploys. The
   resulting principal has no user id (the deploy is single-user).

2. **BetterAuth JWT** — when ``NOTEBOOKFLOW_JWKS_URL`` is set, a bearer token
   that is *not* the static secret is verified as a JWT against the cached JWKS
   (EdDSA / ES256 / RS256). The ``sub`` claim becomes the authenticated user id,
   letting the engine attribute a request to a specific tenant.

When **neither** env var is set the engine is open — preserving the prior local
/ single-user behaviour. The two can be combined: a request authenticates if it
matches the static secret *or* presents a valid JWT.

This module owns no FastAPI types so it can be unit-tested in isolation; the
server adapts :class:`AuthError` into HTTP 401 / WS 1008.
"""

from __future__ import annotations

import os
import secrets
import threading
from dataclasses import dataclass

import jwt
from jwt import PyJWKClient

# BetterAuth's JWT plugin defaults to EdDSA; ES256/RS256 are supported so a
# differently-configured issuer still verifies.
_ALGORITHMS = ["EdDSA", "ES256", "RS256"]


@dataclass(frozen=True)
class AuthPrincipal:
    """The authenticated caller.

    ``user_id`` is the JWT ``sub`` for a multi-tenant request, or ``None`` for
    static-token / open (self-host, single-user) access where there is no
    distinct user to attribute work to.
    """

    user_id: str | None


class AuthError(Exception):
    """A presented credential was missing or invalid."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def _static_token() -> str:
    return os.environ.get("NOTEBOOKFLOW_AUTH_TOKEN", "")


def _jwks_url() -> str:
    return os.environ.get("NOTEBOOKFLOW_JWKS_URL", "")


def _jwt_issuer() -> str:
    return os.environ.get("NOTEBOOKFLOW_JWT_ISSUER", "")


def _jwt_audience() -> str:
    return os.environ.get("NOTEBOOKFLOW_JWT_AUDIENCE", "")


def auth_configured() -> bool:
    """True when any auth mechanism is enabled. False ⇒ the engine is open."""
    return _static_token() != "" or _jwks_url() != ""


# PyJWKClient caches the fetched keys and is safe to reuse; keep one per URL so
# the JWKS isn't re-fetched on every request. Reads per-request env so tests can
# point the URL elsewhere via reset_jwks_cache().
_jwks_lock = threading.Lock()
_jwks_clients: dict[str, PyJWKClient] = {}


def _get_jwks_client(url: str) -> PyJWKClient:
    with _jwks_lock:
        client = _jwks_clients.get(url)
        if client is None:
            client = PyJWKClient(url)
            _jwks_clients[url] = client
        return client


def reset_jwks_cache() -> None:
    """Drop cached JWKS clients. Test hook; also useful after key rotation."""
    with _jwks_lock:
        _jwks_clients.clear()


def verify_jwt(token: str) -> str:
    """Verify a BetterAuth JWT against the configured JWKS, returning ``sub``.

    Raises :class:`AuthError` on any failure (unconfigured, network, signature,
    expiry, missing claim).
    """
    url = _jwks_url()
    if url == "":
        raise AuthError("jwt auth not configured")
    audience = _jwt_audience()
    issuer = _jwt_issuer()
    try:
        signing_key = _get_jwks_client(url).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=_ALGORITHMS,
            audience=audience or None,
            issuer=issuer or None,
            options={"require": ["exp", "sub"], "verify_aud": audience != ""},
        )
    except AuthError:
        raise
    except Exception as exc:  # PyJWTError, JWKS fetch errors, etc.
        raise AuthError(f"invalid token: {exc}") from exc

    sub = claims.get("sub")
    if not isinstance(sub, str) or sub == "":
        raise AuthError("token missing sub claim")
    return sub


def authenticate(token: str) -> AuthPrincipal:
    """Resolve a presented bearer/query token to an :class:`AuthPrincipal`.

    - Nothing configured ⇒ open: ``AuthPrincipal(None)``.
    - Matches the static secret ⇒ ``AuthPrincipal(None)`` (self-host).
    - Otherwise, if a JWKS URL is set ⇒ verify as a JWT ⇒ ``AuthPrincipal(sub)``.
    - Otherwise ⇒ :class:`AuthError`.
    """
    if not auth_configured():
        return AuthPrincipal(user_id=None)

    static = _static_token()
    if static != "" and token != "" and secrets.compare_digest(token, static):
        return AuthPrincipal(user_id=None)

    if _jwks_url() != "":
        return AuthPrincipal(user_id=verify_jwt(token))

    # Static secret configured but the token didn't match, and no JWT fallback.
    raise AuthError("invalid bearer token")
