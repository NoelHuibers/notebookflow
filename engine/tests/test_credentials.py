"""Tests for BYOK credential resolution."""

from __future__ import annotations

import pytest

from notebookflow.llm.credentials import resolve_credentials

_ENV_KEYS = (
    "NOTEBOOKFLOW_LLM_API_KEY",
    "NOTEBOOKFLOW_LLM_PROVIDER",
    "NOTEBOOKFLOW_LLM_MODEL",
    "NOTEBOOKFLOW_ANTHROPIC_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
)


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in _ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def test_per_request_key_wins() -> None:
    creds = resolve_credentials(provider="openai", model="gpt-4o", api_key="sk-user")
    assert creds is not None
    assert (creds.provider, creds.model, creds.api_key) == ("openai", "gpt-4o", "sk-user")


def test_per_request_defaults_model_from_provider() -> None:
    creds = resolve_credentials(provider="anthropic", model="", api_key="sk-user")
    assert creds is not None
    assert creds.model == "claude-sonnet-4-6"


def test_per_request_defaults_provider_to_anthropic() -> None:
    creds = resolve_credentials(provider="", model="", api_key="sk-user")
    assert creds is not None
    assert creds.provider == "anthropic"


def test_no_request_key_falls_back_to_env_anthropic(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-env")
    creds = resolve_credentials()
    assert creds is not None
    assert creds.provider == "anthropic"
    assert creds.api_key == "sk-env"


def test_no_request_key_falls_back_to_env_openai(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-env")
    creds = resolve_credentials()
    assert creds is not None
    assert creds.provider == "openai"
    assert creds.api_key == "sk-openai-env"


def test_generic_env_key_with_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NOTEBOOKFLOW_LLM_API_KEY", "sk-generic")
    monkeypatch.setenv("NOTEBOOKFLOW_LLM_PROVIDER", "deepseek")
    creds = resolve_credentials()
    assert creds is not None
    assert creds.provider == "deepseek"
    assert creds.model == "deepseek-chat"


def test_nothing_configured_returns_none() -> None:
    assert resolve_credentials() is None
    assert resolve_credentials(provider="openai", model="gpt-4o", api_key="   ") is None
