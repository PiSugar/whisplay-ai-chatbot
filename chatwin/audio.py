"""Audio recording and playback via ALSA's ``arecord``/``aplay``.

ALSA ships by default on Raspberry Pi OS so these tools are always
available and work with a huge range of USB/3.5mm microphones and
speakers. Using subprocess keeps the Python dependency footprint small
and avoids pulling in PortAudio just for recording.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
from typing import Optional

log = logging.getLogger(__name__)


class AudioRecorder:
    """Record a mono WAV file for the duration the button is held.

    Recording is kicked off by :meth:`start` and stopped by :meth:`stop`.
    A hard ``max_seconds`` ceiling guards against runaway recordings if
    the button release event is ever missed.
    """

    def __init__(
        self,
        sample_rate: int = 16000,
        channels: int = 1,
        record_device: str = "default",
        record_format: str = "S16_LE",
        max_record_seconds: int = 60,
        **_: object,
    ) -> None:
        self.sample_rate = int(sample_rate)
        self.channels = int(channels)
        self.record_device = record_device
        self.record_format = record_format
        self.max_record_seconds = int(max_record_seconds)

        self._process: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self._current_path: Optional[str] = None
        self._start_time: float = 0.0

        if not shutil.which("arecord"):
            log.warning(
                "arecord not found in PATH — install alsa-utils "
                "(`sudo apt install alsa-utils`) before recording."
            )

    def start(self, path: Optional[str] = None) -> str:
        """Begin capturing to ``path`` (a temp file is created if omitted)."""
        with self._lock:
            if self._process is not None:
                self._force_stop_locked()

            if path is None:
                fd, path = tempfile.mkstemp(prefix="chatwin-", suffix=".wav")
                os.close(fd)

            cmd = [
                "arecord",
                "-q",
                "-D",
                self.record_device,
                "-f",
                self.record_format,
                "-r",
                str(self.sample_rate),
                "-c",
                str(self.channels),
                "-t",
                "wav",
                "-d",
                str(self.max_record_seconds),
                path,
            ]
            log.info("Starting arecord: %s", " ".join(cmd))
            try:
                self._process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                )
            except FileNotFoundError as exc:
                raise RuntimeError(
                    "arecord not available — install alsa-utils"
                ) from exc

            self._current_path = path
            self._start_time = time.time()
            return path

    def stop(self) -> Optional[str]:
        """Stop the recording and return the resulting WAV path (if any)."""
        with self._lock:
            if self._process is None:
                return None
            path = self._current_path
            duration = time.time() - self._start_time
            self._force_stop_locked()

        if path is None or not os.path.exists(path):
            return None
        # Discard obviously-empty recordings.
        if duration < 0.2 or os.path.getsize(path) < 1024:
            log.info(
                "Discarding short recording (%.2fs, %d bytes)",
                duration,
                os.path.getsize(path) if os.path.exists(path) else 0,
            )
            try:
                os.remove(path)
            except OSError:
                pass
            return None
        log.info("Stopped arecord after %.2fs -> %s", duration, path)
        return path

    def _force_stop_locked(self) -> None:
        process = self._process
        self._process = None
        self._current_path = None
        if process is None:
            return
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                try:
                    process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    pass


def play_audio(path: str, device: str = "default") -> None:
    """Play a WAV/MP3 file synchronously using ``aplay``."""
    if not path or not os.path.exists(path):
        log.warning("play_audio: file not found: %s", path)
        return
    if not shutil.which("aplay"):
        log.warning("aplay not found in PATH — skipping playback")
        return
    try:
        subprocess.run(
            ["aplay", "-q", "-D", device, path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except Exception:  # pragma: no cover - audio hardware is runtime
        log.exception("Failed to play %s", path)
