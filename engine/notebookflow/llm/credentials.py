"""Credential resolution for the LLM feature modules (BYOK).

Precedence, highest first:
1. Per-request credentials (the web-app's Settings: provider + model + key).
2. A self-host environment key (NOTEBOOKFLOW_LLM_API_KEY, or the legacy
   ANTHROPIC_API_KEY / OPENAI_API_KEY).
3. None -- the caller falls back to its deterministic template backend.

The resolved CredentialContext is what every LLM module hands to the
LLMClient gateway. Credentials are never logged.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

_DEFAULT_PROVIDER = "anthropic"

# Default model per provider when a provider is chosen but no model is given.
_DEFAULT_MODEL: dict[str, str] = {
    "anthropic": "claude-sonnet-4-6",
    "openai": "gpt-4o",
    "moonshot": "moonshot-v1-8k",
    "kimi": "moonshot-v1-8k",
    "deepseek": "deepseek-chat",
    "qwen": "qwen-plus",
    "dashscope": "qwen-plus",
}


@dataclass(slots=True)
class CredentialContext:
    provider: str
    model: str
    api_key: str


def default_model_for(provider: str) -> str:
    return _DEFAULT_MODEL.get(provider.strip().lower(), "")


def resolve_credentials(
    provider: str = "",
    model: str = "",
    api_key: str = "",
) -> CredentialContext | None:
    """Per-request credentials win; otherwise fall back to a self-host env key.
    Returns None when nothing is configured (caller uses its template backend)."""
    if api_key.strip() != "":
        prov = (provider.strip() or _DEFAULT_PROVIDER).lower()
        chosen = model.strip() or default_model_for(prov)
        return CredentialContext(prov, chosen, api_key.strip())
    return _env_credentials()


def _env_credentials() -> CredentialContext | None:
    generic = os.environ.get("NOTEBOOKFLOW_LLM_API_KEY", "").strip()
    if generic != "":
        prov = os.environ.get("NOTEBOOKFLOW_LLM_PROVIDER", "").strip().lower() or _DEFAULT_PROVIDER
        model = os.environ.get("NOTEBOOKFLOW_LLM_MODEL", "").strip() or default_model_for(prov)
        return CredentialContext(prov, model, generic)

    anthropic = (
        os.environ.get("NOTEBOOKFLOW_ANTHROPIC_API_KEY", "")
        or os.environ.get("ANTHROPIC_API_KEY", "")
    ).strip()
    if anthropic != "":
        model = os.environ.get("NOTEBOOKFLOW_ANTHROPIC_MODEL", "").strip()
        return CredentialContext("anthropic", model or default_model_for("anthropic"), anthropic)

    openai = os.environ.get("OPENAI_API_KEY", "").strip()
    if openai != "":
        model = os.environ.get("NOTEBOOKFLOW_OPENAI_MODEL", "").strip()
        return CredentialContext("openai", model or default_model_for("openai"), openai)

    return None
