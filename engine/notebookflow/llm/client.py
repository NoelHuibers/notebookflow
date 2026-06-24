"""Provider-agnostic LLM gateway (bring-your-own-key).

Callers pass ``(provider, model, api_key)`` per request; the gateway never
reads credentials from the environment. It routes to the right provider via
LiteLLM, but behind our own ``LLMClient`` seam so callers and tests depend on
this interface -- not on LiteLLM directly. That keeps the feature modules'
template fallbacks + structured-output parsing ours and makes the underlying
library swappable.

Most non-Anthropic providers are OpenAI-compatible and LiteLLM routes them by
a ``provider/model`` prefix, so adding a provider is a one-line change to
``_PROVIDER_PREFIX``.

This module is the seam only; wiring the four LLM feature modules
(code_synth / explainer / pipeline_author / ask) through it is a later slice.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

# Our provider name -> LiteLLM model prefix. Aliases (kimi, qwen) map onto the
# library's canonical provider id.
_PROVIDER_PREFIX: dict[str, str] = {
    "anthropic": "anthropic",
    "openai": "openai",
    "moonshot": "moonshot",
    "kimi": "moonshot",
    "deepseek": "deepseek",
    "qwen": "dashscope",
    "dashscope": "dashscope",
}

_DEFAULT_MAX_TOKENS = 1024


class LLMError(RuntimeError):
    """Raised when a provider call fails, the provider is unknown, the key is
    missing, or the completion is empty. Callers catch this to fall back to
    their deterministic template backend -- exactly as today.
    """


def supported_providers() -> list[str]:
    """The provider names the gateway accepts."""
    return sorted(_PROVIDER_PREFIX)


class LLMClient:
    """Single async entry point over LiteLLM, stateless and safe to share.

    ``acompletion`` is injectable so tests can supply a fake without the
    network or the heavy library; production leaves it unset and the real
    LiteLLM ``acompletion`` is imported lazily on first use.
    """

    def __init__(self, acompletion: Callable[..., Awaitable[Any]] | None = None) -> None:
        self._acompletion_override = acompletion

    async def complete(
        self,
        *,
        provider: str,
        model: str,
        api_key: str,
        messages: list[dict[str, str]],
        system: str = "",
        max_tokens: int = _DEFAULT_MAX_TOKENS,
    ) -> str:
        """Return the completion text, or raise ``LLMError`` so the caller can
        fall back to a template. Credentials are never logged."""
        prefix = _PROVIDER_PREFIX.get(provider.strip().lower())
        if prefix is None:
            raise LLMError(f"Unknown LLM provider: {provider!r}")
        if api_key.strip() == "":
            raise LLMError(f"No API key provided for {provider}")

        full_model = f"{prefix}/{model}"
        full_messages: list[dict[str, str]] = (
            [{"role": "system", "content": system}, *messages] if system != "" else list(messages)
        )

        try:
            response = await self._acompletion(
                model=full_model,
                messages=full_messages,
                api_key=api_key,
                max_tokens=max_tokens,
            )
        except Exception as exc:  # noqa: BLE001 -- LiteLLM raises provider-specific errors
            # Deliberately omit the message/args so a provider can't leak the
            # key back through an exception string.
            raise LLMError(f"{provider} request failed ({type(exc).__name__})") from None

        text = _extract_text(response)
        if text == "":
            raise LLMError(f"{provider} returned an empty completion")
        return text

    async def _acompletion(self, **kwargs: Any) -> Any:
        """Seam over LiteLLM. Imported lazily so the heavy library only loads
        when a real call is made; tests inject a fake via the constructor."""
        if self._acompletion_override is not None:
            return await self._acompletion_override(**kwargs)
        from litellm import acompletion  # noqa: PLC0415

        return await acompletion(**kwargs)


def _extract_text(response: Any) -> str:
    """Pull the assistant text out of a LiteLLM (OpenAI-shaped) response."""
    try:
        choices = response.choices
    except AttributeError:
        return ""
    if not choices:
        return ""
    try:
        content = choices[0].message.content
    except (AttributeError, IndexError, TypeError):
        return ""
    return content.strip() if isinstance(content, str) else ""
