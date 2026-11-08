#!/usr/bin/env python3

"""Emit Whisplay Hat Plus GPIO button events as newline-delimited JSON."""

import json
import os
import signal
import sys
import time

import gpiod


BUTTON_GPIO = int(os.getenv("WHISPLAY_HAT_PLUS_BUTTON_GPIO", "17"))
POLL_INTERVAL_SECONDS = 0.01
DEBOUNCE_SECONDS = 0.03
RUNNING = True


def _stop(_signum, _frame):
    global RUNNING
    RUNNING = False


def _open_button_line():
    chip_path = next(
        (path for path in ("/dev/gpiochip4", "/dev/gpiochip0") if os.path.exists(path)),
        "/dev/gpiochip0",
    )
    chip = gpiod.Chip(chip_path)

    if hasattr(gpiod, "LineSettings"):
        from gpiod.line import Bias, Direction, Value

        try:
            settings = gpiod.LineSettings(
                direction=Direction.INPUT,
                bias=Bias.DISABLED,
            )
        except Exception:
            settings = gpiod.LineSettings(direction=Direction.INPUT)
        request = chip.request_lines(
            consumer="whisplay-hat-plus-chatbot-button",
            config={BUTTON_GPIO: settings},
        )
        return (
            chip,
            request,
            lambda: 1 if request.get_value(BUTTON_GPIO) == Value.ACTIVE else 0,
        )

    line = chip.get_line(BUTTON_GPIO)
    try:
        line.request(
            consumer="whisplay-hat-plus-chatbot-button",
            type=gpiod.LINE_REQ_DIR_IN,
            flags=gpiod.LINE_REQ_FLAG_BIAS_DISABLE,
        )
    except Exception:
        line.request(
            consumer="whisplay-hat-plus-chatbot-button",
            type=gpiod.LINE_REQ_DIR_IN,
        )
    return chip, line, lambda: int(line.get_value())


def _emit(event):
    print(json.dumps({"event": event}), flush=True)


def main():
    chip, line, read_value = _open_button_line()
    stable_value = read_value()
    candidate_value = stable_value
    candidate_since = time.monotonic()

    try:
        while RUNNING:
            value = read_value()
            now = time.monotonic()
            if value != candidate_value:
                candidate_value = value
                candidate_since = now
            elif value != stable_value and now - candidate_since >= DEBOUNCE_SECONDS:
                stable_value = value
                _emit("button_pressed" if stable_value else "button_released")
            time.sleep(POLL_INTERVAL_SECONDS)
    finally:
        release = getattr(line, "release", None)
        if release:
            release()
        close = getattr(chip, "close", None)
        if close:
            close()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    try:
        main()
    except Exception as error:
        print(f"[HatPlusButton] {error}", file=sys.stderr, flush=True)
        raise SystemExit(1)
