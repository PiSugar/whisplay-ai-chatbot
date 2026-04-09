"""Minimal OpenAI-compatible text-to-speech client.

Like the LLM client, pointing ``base_url`` at a compatible server (e.g.
an OpenAI speech mirror) is enough to swap providers. TTS is optional —
setting ``tts.enabled`` to ``false`` in the config disables it entirely.
"""

from __future__ import annotations

import logging
import os
import tempfile
from typing import Optional

import requests

log = logging.getLogger(__name__)


class TTSClient:
    def __init__(
        self,
        enabled: bool = True,
        api_key: str = "",
        base_url: str = "https://api.openai.com/v1",
        model: str = "tts-1",
        voice: str = "alloy",
        response_format: str = "wav",
        request_timeout: int = 60,
        **_: object,
    ) -> None:
        self.enabled = bool(enabled)
        self.api_key = api_key or ""
        self.base_url = (base_url or "").rstrip("/")
        self.model = model
        self.voice = voice
        self.response_format = response_format or "wav"
        self.request_timeout = int(request_timeout)

    def synthesize(self, text: str, output_path: Optional[str] = None) -> Optional[str]:
        """Turn ``text`` into an audio file and return its path.

        Returns ``None`` if TTS is disabled or the server returns no
        audio data.
        """
        if not self.enabled:
            return None
        if not text:
            return None
        if not self.api_key:
            raise RuntimeError("TTS api_key is empty — set it in config.json")
        if not self.base_url:
            raise RuntimeError("TTS base_url is empty — set it in config.json")

        if output_path is None:
            suffix = "." + self.response_format.lstrip(".")
            fd, output_path = tempfile.mkstemp(prefix="chatwin-tts-", suffix=suffix)
            os.close(fd)

        url = f"{self.base_url}/audio/speech"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "input": text,
            "voice": self.voice,
            "response_format": self.response_format,
        }
        log.info("TTS request: model=%s voice=%s", self.model, self.voice)
        try:
            response = requests.post(
                url,
                json=payload,
                headers=headers,
                timeout=self.request_timeout,
            )
        except requests.RequestException as exc:
            raise RuntimeError(f"TTS request failed: {exc}") from exc

        if response.status_code >= 400:
            detail = (response.text or "")[:500]
            raise RuntimeError(f"TTS error {response.status_code}: {detail}")

        with open(output_path, "wb") as f:
            f.write(response.content)
        if os.path.getsize(output_path) == 0:
            os.remove(output_path)
            return None
        return output_path
