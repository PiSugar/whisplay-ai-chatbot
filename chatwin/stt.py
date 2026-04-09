"""Speech-to-text using faster-whisper.

faster-whisper runs the Whisper model on-device via CTranslate2, which
is fast enough on a Raspberry Pi 4/5 with ``int8`` quantisation and the
``tiny`` or ``base`` models. The model is loaded once at start up and
reused for every utterance.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

log = logging.getLogger(__name__)


class SpeechToText:
    def __init__(
        self,
        model_size_or_path: str = "tiny",
        device: str = "cpu",
        compute_type: str = "int8",
        cpu_threads: int = 3,
        language: Optional[str] = "en",
        vad_filter: bool = True,
        **_: object,
    ) -> None:
        self.model_size_or_path = model_size_or_path
        self.device = device
        self.compute_type = compute_type
        self.cpu_threads = int(cpu_threads)
        self.language = language or None
        self.vad_filter = bool(vad_filter)
        self._model = None

    def load(self) -> None:
        """Load the Whisper model. Safe to call multiple times."""
        if self._model is not None:
            return
        try:
            from faster_whisper import WhisperModel  # type: ignore
        except ImportError as exc:  # pragma: no cover - runtime guard
            raise RuntimeError(
                "faster-whisper is required for STT. "
                "Install with `pip install faster-whisper`."
            ) from exc

        log.info(
            "Loading faster-whisper model '%s' (device=%s, compute=%s)",
            self.model_size_or_path,
            self.device,
            self.compute_type,
        )
        t0 = time.perf_counter()
        self._model = WhisperModel(
            self.model_size_or_path,
            device=self.device,
            cpu_threads=self.cpu_threads,
            compute_type=self.compute_type,
        )
        log.info(
            "faster-whisper model loaded in %.2fs",
            time.perf_counter() - t0,
        )

    def transcribe(self, audio_path: str) -> str:
        """Transcribe the given audio file and return the text."""
        if self._model is None:
            self.load()
        assert self._model is not None

        t0 = time.perf_counter()
        segments, info = self._model.transcribe(
            audio_path,
            language=self.language,
            vad_filter=self.vad_filter,
        )
        text = "".join(segment.text for segment in segments).strip()
        log.info(
            "STT done in %.2fs (lang=%s): %r",
            time.perf_counter() - t0,
            getattr(info, "language", None),
            text,
        )
        return text
