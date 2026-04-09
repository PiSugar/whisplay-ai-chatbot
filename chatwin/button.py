"""GPIO push button wrapper for generic Raspberry Pi boards.

The original project used the on-board button on the Whisplay HAT via a
fixed physical pin and a bespoke polling loop. This module replaces that
with a user-configurable GPIO pin using ``gpiozero``, which transparently
picks the best backend (lgpio on Pi 5/Bookworm, RPi.GPIO on older Pis).

The button is treated as hold-to-talk: the ``on_press`` callback fires
when the button is pressed and ``on_release`` fires when it is released.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional

log = logging.getLogger(__name__)


class GPIOButton:
    """Thin wrapper around :class:`gpiozero.Button`.

    Parameters
    ----------
    pin:
        BCM GPIO pin number the button is connected to.
    pull_up:
        ``True`` (default) when the other leg of the button is wired to
        ground — the common wiring for a simple push button. Set to
        ``False`` when the other leg is wired to 3V3.
    bounce_time_ms:
        Debounce interval in milliseconds.
    """

    def __init__(
        self,
        pin: int,
        pull_up: bool = True,
        bounce_time_ms: int = 50,
        **_: object,
    ) -> None:
        self.pin = int(pin)
        self.pull_up = bool(pull_up)
        self.bounce_time_ms = int(bounce_time_ms)
        self.on_press: Optional[Callable[[], None]] = None
        self.on_release: Optional[Callable[[], None]] = None

        try:
            from gpiozero import Button as _GZButton  # type: ignore
        except ImportError as exc:  # pragma: no cover - import-time guard
            raise RuntimeError(
                "gpiozero is required for GPIO button support. Install it "
                "with `pip install gpiozero lgpio` on Raspberry Pi."
            ) from exc

        bounce_seconds = self.bounce_time_ms / 1000.0 if self.bounce_time_ms else None
        self._button = _GZButton(
            self.pin,
            pull_up=self.pull_up,
            bounce_time=bounce_seconds,
        )
        self._button.when_pressed = self._fire_press
        self._button.when_released = self._fire_release
        log.info(
            "GPIO button ready on BCM pin %d (pull_up=%s, debounce=%dms)",
            self.pin,
            self.pull_up,
            self.bounce_time_ms,
        )

    # ---- callbacks -----------------------------------------------------
    def _fire_press(self) -> None:
        if self.on_press is not None:
            try:
                self.on_press()
            except Exception:  # pragma: no cover - user callback safety
                log.exception("Error in button press handler")

    def _fire_release(self) -> None:
        if self.on_release is not None:
            try:
                self.on_release()
            except Exception:  # pragma: no cover - user callback safety
                log.exception("Error in button release handler")

    # ---- helpers -------------------------------------------------------
    def is_pressed(self) -> bool:
        return bool(self._button.is_pressed)

    def close(self) -> None:
        try:
            self._button.close()
        except Exception:  # pragma: no cover - cleanup must not raise
            log.debug("GPIO button close raised", exc_info=True)
