"""Tests for the provider-agnostic LLMClient gateway (BYOK)."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from notebookflow.llm.client import LLMClient, LLMError, supported_providers


def _response(text: str) -> SimpleNamespace:
    """A minimal LiteLLM/OpenAI-shaped response object."""
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


def _capturing_client(text: str = "hello") -> tuple[LLMClient, list[dict[str, Any]]]:
    """An LLMClient whose injected completion records the kwargs it was called
    with and returns a canned response."""
    calls: list[dict[str, Any]] = []

    async def fake(**kwargs: Any) -> SimpleNamespace:
        calls.append(kwargs)
        return _response(text)

    return LLMClient(acompletion=fake), calls


async def test_routes_anthropic_with_prefix() -> None:
    client, calls = _capturing_client("ok")
    out = await client.complete(
        provider="anthropic",
        model="claude-sonnet-4-6",
        api_key="sk-test",
        messages=[{"role": "user", "content": "hi"}],
    )
    assert out == "ok"
    assert calls[0]["model"] == "anthropic/claude-sonnet-4-6"


async def test_routes_openai_with_prefix() -> None:
    client, calls = _capturing_client()
    await client.complete(
        provider="openai",
        model="gpt-4o",
        api_key="sk-test",
        messages=[{"role": "user", "content": "hi"}],
    )
    assert calls[0]["model"] == "openai/gpt-4o"


async def test_routes_openai_compatible_provider() -> None:
    client, calls = _capturing_client()
    await client.complete(
        provider="deepseek",
        model="deepseek-chat",
        api_key="sk-test",
        messages=[{"role": "user", "content": "hi"}],
    )
    assert calls[0]["model"] == "deepseek/deepseek-chat"


async def test_alias_kimi_maps_to_moonshot() -> None:
    client, calls = _capturing_client()
    await client.complete(
        provider="Kimi",
        model="moonshot-v1-8k",
        api_key="sk-test",
        messages=[{"role": "user", "content": "hi"}],
    )
    assert calls[0]["model"] == "moonshot/moonshot-v1-8k"


async def test_passes_supplied_key_and_max_tokens_through() -> None:
    client, calls = _capturing_client()
    await client.complete(
        provider="openai",
        model="gpt-4o",
        api_key="sk-user-123",
        messages=[{"role": "user", "content": "hi"}],
        max_tokens=256,
    )
    assert calls[0]["api_key"] == "sk-user-123"
    assert calls[0]["max_tokens"] == 256


async def test_prepends_system_message() -> None:
    client, calls = _capturing_client()
    await client.complete(
        provider="openai",
        model="gpt-4o",
        api_key="sk-test",
        messages=[{"role": "user", "content": "hi"}],
        system="You are terse.",
    )
    sent = calls[0]["messages"]
    assert sent[0] == {"role": "system", "content": "You are terse."}
    assert sent[1] == {"role": "user", "content": "hi"}


async def test_unknown_provider_raises() -> None:
    client, _ = _capturing_client()
    with pytest.raises(LLMError, match="Unknown LLM provider"):
        await client.complete(
            provider="bogus",
            model="x",
            api_key="sk-test",
            messages=[{"role": "user", "content": "hi"}],
        )


async def test_missing_key_raises() -> None:
    client, _ = _capturing_client()
    with pytest.raises(LLMError, match="No API key"):
        await client.complete(
            provider="openai",
            model="gpt-4o",
            api_key="   ",
            messages=[{"role": "user", "content": "hi"}],
        )


async def test_empty_completion_raises() -> None:
    client, _ = _capturing_client(text="")
    with pytest.raises(LLMError, match="empty completion"):
        await client.complete(
            provider="openai",
            model="gpt-4o",
            api_key="sk-test",
            messages=[{"role": "user", "content": "hi"}],
        )


async def test_provider_exception_becomes_llm_error_without_leaking_key() -> None:
    async def boom(**_kwargs: Any) -> Any:
        raise RuntimeError("auth failed for key sk-secret-should-not-leak")

    client = LLMClient(acompletion=boom)

    with pytest.raises(LLMError) as excinfo:
        await client.complete(
            provider="anthropic",
            model="claude",
            api_key="sk-secret-should-not-leak",
            messages=[{"role": "user", "content": "hi"}],
        )
    # The wrapped message must not echo the provider's error text (which could
    # contain the key); only the exception type is surfaced.
    assert "sk-secret-should-not-leak" not in str(excinfo.value)


def test_supported_providers_lists_known_set() -> None:
    providers = supported_providers()
    for expected in ("anthropic", "openai", "deepseek", "moonshot", "qwen"):
        assert expected in providers
