"""Minimal OpenAI-compatible chat client with streaming support.

The chat completions endpoint is supported by OpenAI itself plus a wide
range of local and third-party servers (Ollama's OpenAI-compatible
endpoint, LocalAI, vLLM, Groq, DeepSeek, etc.), so pointing ``base_url``
at a different host is usually enough to swap providers.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Iterable, Iterator, List, Optional

import requests

log = logging.getLogger(__name__)


class LLMClient:
    def __init__(
        self,
        api_key: str = "",
        base_url: str = "https://api.openai.com/v1",
        model: str = "gpt-4o-mini",
        system_prompt: str = "",
        max_history: int = 10,
        request_timeout: int = 60,
        stream: bool = True,
        enabled: bool = True,
        **_: object,
    ) -> None:
        self.api_key = api_key or ""
        self.base_url = (base_url or "").rstrip("/")
        self.model = model
        self.system_prompt = system_prompt or ""
        self.max_history = max(0, int(max_history))
        self.request_timeout = int(request_timeout)
        self.stream = bool(stream)
        self.enabled = bool(enabled)
        self._history: List[Dict[str, str]] = []

    # ---- history -------------------------------------------------------
    def reset_history(self) -> None:
        self._history.clear()

    def _append_history(self, role: str, content: str) -> None:
        self._history.append({"role": role, "content": content})
        if self.max_history > 0 and len(self._history) > self.max_history:
            self._history = self._history[-self.max_history :]

    def _build_messages(self, user_message: str) -> List[Dict[str, str]]:
        messages: List[Dict[str, str]] = []
        if self.system_prompt:
            messages.append({"role": "system", "content": self.system_prompt})
        messages.extend(self._history)
        messages.append({"role": "user", "content": user_message})
        return messages

    # ---- chat ----------------------------------------------------------
    def chat_stream(self, user_message: str) -> Iterator[str]:
        """Yield the assistant's response text in streaming chunks.

        When streaming is disabled (or not supported by the server), the
        full response is yielded as a single chunk.
        """
        if not self.enabled:
            raise RuntimeError("LLM is disabled in config")
        if not self.api_key:
            raise RuntimeError("LLM api_key is empty — set it in config.json")
        if not self.base_url:
            raise RuntimeError("LLM base_url is empty — set it in config.json")

        messages = self._build_messages(user_message)
        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": self.stream,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        url = f"{self.base_url}/chat/completions"

        log.info("LLM request: model=%s stream=%s", self.model, self.stream)

        collected = ""
        try:
            response = requests.post(
                url,
                json=payload,
                headers=headers,
                stream=self.stream,
                timeout=self.request_timeout,
            )
        except requests.RequestException as exc:
            raise RuntimeError(f"LLM request failed: {exc}") from exc

        if response.status_code >= 400:
            detail = (response.text or "")[:500]
            raise RuntimeError(
                f"LLM error {response.status_code}: {detail}"
            )

        try:
            if self.stream:
                for delta in self._iter_stream_chunks(response):
                    collected += delta
                    yield delta
            else:
                data = response.json()
                content = (
                    data.get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", "")
                )
                collected = content or ""
                if collected:
                    yield collected
        finally:
            response.close()

        if user_message:
            self._append_history("user", user_message)
        if collected:
            self._append_history("assistant", collected)

    def _iter_stream_chunks(
        self, response: requests.Response
    ) -> Iterable[str]:
        for raw_line in response.iter_lines(decode_unicode=False):
            if not raw_line:
                continue
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line.startswith("data:"):
                continue
            data = line[len("data:") :].strip()
            if not data or data == "[DONE]":
                if data == "[DONE]":
                    return
                continue
            try:
                obj = json.loads(data)
            except json.JSONDecodeError:
                continue
            choices = obj.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta") or {}
            chunk = delta.get("content")
            if chunk:
                yield chunk

    def chat(self, user_message: str) -> str:
        """Convenience helper that returns the full response as a string."""
        return "".join(self.chat_stream(user_message))
