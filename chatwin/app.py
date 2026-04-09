"""Main ChatWin orchestrator.

Ties together the GPIO button, audio recorder, faster-whisper STT, LLM
chat client, TTS and web display into a simple hold-to-talk loop:

1. Button pressed  -> start recording
2. Button released -> stop recording, transcribe with faster-whisper
3. LLM streams response -> pushed to the web display as it arrives
4. TTS synthesises speech -> played back through the speakers
5. Return to idle.

Every step updates the web UI so the user can follow along even without
audio feedback.
"""

from __future__ import annotations

import logging
import os
import tempfile
import threading
import time
from typing import Optional

from .audio import AudioRecorder, play_audio
from .button import GPIOButton
from .config import get_section
from .llm import LLMClient
from .stt import SpeechToText
from .tts import TTSClient
from .web_display import WebDisplay

log = logging.getLogger(__name__)

STATE_IDLE = "idle"
STATE_LISTENING = "listening"
STATE_TRANSCRIBING = "transcribing"
STATE_THINKING = "thinking"
STATE_ANSWERING = "answering"
STATE_SPEAKING = "speaking"
STATE_ERROR = "error"

DEFAULT_EMOJIS = {
    STATE_IDLE: "🙂",
    STATE_LISTENING: "🎙️",
    STATE_TRANSCRIBING: "📝",
    STATE_THINKING: "🤔",
    STATE_ANSWERING: "💬",
    STATE_SPEAKING: "🔈",
    STATE_ERROR: "⚠️",
}


class ChatApp:
    def __init__(self, config: dict) -> None:
        self.config = config
        self.running = False

        audio_cfg = get_section(config, "audio")
        button_cfg = get_section(config, "button")
        stt_cfg = get_section(config, "stt")
        llm_cfg = get_section(config, "llm")
        tts_cfg = get_section(config, "tts")
        web_cfg = get_section(config, "web_display")

        self.playback_device = audio_cfg.get("playback_device", "default")

        self.web = WebDisplay(**web_cfg)
        self.recorder = AudioRecorder(**audio_cfg)
        self.stt = SpeechToText(**stt_cfg)
        self.llm = LLMClient(**llm_cfg)
        self.tts = TTSClient(**tts_cfg)

        # Button is optional only in the sense that the app can run the
        # web UI even if GPIO initialisation fails — useful for testing
        # from a desktop. On the Pi it should always succeed.
        self.button: Optional[GPIOButton] = None
        self._button_cfg = button_cfg

        self._state_lock = threading.Lock()
        self._state = STATE_IDLE
        self._worker: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def start(self) -> None:
        if self.running:
            return
        self.running = True
        self._stop_event.clear()

        log.info("Starting web display")
        self.web.start()
        self.web.update(
            status=STATE_IDLE,
            emoji=DEFAULT_EMOJIS[STATE_IDLE],
            text="Loading speech model…",
            user_text="",
        )

        # Loading the model can take a few seconds; do it up front so the
        # first button press has no extra latency.
        try:
            self.stt.load()
        except Exception as exc:
            log.exception("Failed to load STT model")
            self.web.update(
                status=STATE_ERROR,
                emoji=DEFAULT_EMOJIS[STATE_ERROR],
                text=f"Failed to load speech model: {exc}",
            )

        try:
            self.button = GPIOButton(**self._button_cfg)
            self.button.on_press = self._handle_button_press
            self.button.on_release = self._handle_button_release
        except Exception as exc:
            log.exception("Failed to initialise GPIO button")
            self.web.update(
                status=STATE_ERROR,
                emoji=DEFAULT_EMOJIS[STATE_ERROR],
                text=(
                    "GPIO button unavailable. Check the wiring and "
                    f"`button.pin` in config.json. Details: {exc}"
                ),
            )
            self.button = None
            return

        pin = self._button_cfg.get("pin")
        self.web.update(
            status=STATE_IDLE,
            emoji=DEFAULT_EMOJIS[STATE_IDLE],
            text=(
                f"Ready. Hold the button on GPIO {pin} and speak, "
                "then release to hear the answer."
            ),
            user_text="",
        )
        log.info("ChatWin is ready")

    def stop(self) -> None:
        if not self.running:
            return
        log.info("Stopping ChatWin")
        self.running = False
        self._stop_event.set()
        try:
            self.recorder.stop()
        except Exception:
            log.debug("Recorder stop raised", exc_info=True)

    def cleanup(self) -> None:
        """Release hardware and network resources."""
        try:
            if self._worker and self._worker.is_alive():
                self._worker.join(timeout=5)
        except Exception:
            log.debug("Worker join raised", exc_info=True)
        try:
            if self.button is not None:
                self.button.close()
        except Exception:
            log.debug("Button cleanup raised", exc_info=True)
        try:
            self.web.stop()
        except Exception:
            log.debug("Web display stop raised", exc_info=True)

    # ------------------------------------------------------------------
    # State helpers
    # ------------------------------------------------------------------
    def _set_state(self, new_state: str) -> bool:
        with self._state_lock:
            if self._state == new_state:
                return False
            self._state = new_state
            return True

    def _current_state(self) -> str:
        with self._state_lock:
            return self._state

    def _publish(self, state: str, text: str, **extra) -> None:
        self._set_state(state)
        payload = {
            "status": state,
            "emoji": DEFAULT_EMOJIS.get(state, "•"),
            "text": text,
        }
        payload.update(extra)
        self.web.update(**payload)

    # ------------------------------------------------------------------
    # Button handlers
    # ------------------------------------------------------------------
    def _handle_button_press(self) -> None:
        if not self.running:
            return
        if self._current_state() != STATE_IDLE:
            log.debug(
                "Ignoring button press while in state %s", self._current_state()
            )
            return
        if not self._set_state(STATE_LISTENING):
            return
        self.web.update(
            status=STATE_LISTENING,
            emoji=DEFAULT_EMOJIS[STATE_LISTENING],
            text="Listening… release the button when you're done.",
            user_text="",
        )
        try:
            self.recorder.start()
        except Exception as exc:
            log.exception("Failed to start recording")
            self._publish(
                STATE_ERROR,
                f"Could not start recording: {exc}",
            )
            self._set_state(STATE_IDLE)

    def _handle_button_release(self) -> None:
        if not self.running:
            return
        if self._current_state() != STATE_LISTENING:
            return
        path = self.recorder.stop()
        if path is None:
            self._publish(
                STATE_IDLE,
                "Didn't catch anything — hold the button a bit longer.",
            )
            return

        # Run the heavy work off the GPIO callback thread so it returns
        # immediately and the button library stays responsive.
        self._worker = threading.Thread(
            target=self._process_recording,
            args=(path,),
            name="chatwin-worker",
            daemon=True,
        )
        self._worker.start()

    # ------------------------------------------------------------------
    # Core pipeline
    # ------------------------------------------------------------------
    def _process_recording(self, audio_path: str) -> None:
        try:
            self._publish(
                STATE_TRANSCRIBING,
                "Transcribing what you just said…",
            )
            user_text = ""
            try:
                user_text = self.stt.transcribe(audio_path)
            except Exception as exc:
                log.exception("STT failed")
                self._publish(
                    STATE_ERROR,
                    f"Speech recognition failed: {exc}",
                )
                return

            if not user_text:
                self._publish(
                    STATE_IDLE,
                    "I couldn't make out any words. Try again.",
                )
                return

            self.web.append_message("user", user_text)
            self._publish(
                STATE_THINKING,
                "Thinking…",
                user_text=user_text,
            )

            if not self.llm.enabled:
                self._publish(
                    STATE_IDLE,
                    "LLM is disabled in config.json.",
                    user_text=user_text,
                )
                return

            response_text = ""
            try:
                for delta in self.llm.chat_stream(user_text):
                    response_text += delta
                    self.web.update(
                        status=STATE_ANSWERING,
                        emoji=DEFAULT_EMOJIS[STATE_ANSWERING],
                        text=response_text,
                    )
                    self._set_state(STATE_ANSWERING)
            except Exception as exc:
                log.exception("LLM failed")
                self._publish(
                    STATE_ERROR,
                    f"LLM error: {exc}",
                    user_text=user_text,
                )
                return

            response_text = response_text.strip()
            if not response_text:
                self._publish(
                    STATE_IDLE,
                    "The assistant returned an empty response.",
                    user_text=user_text,
                )
                return

            self.web.append_message("assistant", response_text)
            self._publish(
                STATE_ANSWERING,
                response_text,
                user_text=user_text,
            )

            # Text-to-speech and playback (optional).
            if self.tts.enabled:
                self._publish(
                    STATE_SPEAKING,
                    response_text,
                    user_text=user_text,
                )
                tts_path: Optional[str] = None
                try:
                    tts_path = self.tts.synthesize(response_text)
                    if tts_path:
                        play_audio(tts_path, device=self.playback_device)
                except Exception as exc:
                    log.exception("TTS failed")
                    # Don't overwrite the response — just surface a note.
                    self.web.update(
                        status=STATE_ANSWERING,
                        emoji=DEFAULT_EMOJIS[STATE_ANSWERING],
                        text=f"{response_text}\n\n(TTS error: {exc})",
                    )
                finally:
                    if tts_path and os.path.exists(tts_path):
                        try:
                            os.remove(tts_path)
                        except OSError:
                            pass

            self._publish(
                STATE_IDLE,
                "Hold the button to ask another question.",
                user_text=user_text,
            )
        finally:
            try:
                if audio_path and os.path.exists(audio_path):
                    os.remove(audio_path)
            except OSError:
                pass
            self._set_state(STATE_IDLE)
