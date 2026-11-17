#!/usr/bin/env python3

"""Handle Hat Plus button events and RGB updates over newline-delimited JSON."""

import json
import os
import re
import signal
import sys
import time

import gpiod

from whisplay import SoftPWM, _request_output


BUTTON_GPIO = int(os.getenv("WHISPLAY_HAT_PLUS_BUTTON_GPIO", "17"))
POLL_INTERVAL_SECONDS = 0.01
DEBOUNCE_SECONDS = 0.03
RUNNING = True


class LedLine:
    """Handle RP1 lines that need an input pull-down to reach LOW."""

    def __init__(self, chip, offset):
        self.offset = offset
        self.mode = "output"
        self.value = None
        self.line = None
        self.request = None
        if not hasattr(gpiod, "LineSettings"):
            self.line = _request_output(chip, offset, consumer="whisplay-hat-plus-rgb")
            self.line.set_value(1)
            return

        from gpiod.line import Bias, Direction, Value

        self.request = chip.request_lines(
            consumer="whisplay-hat-plus-rgb",
            config={offset: gpiod.LineSettings(
                direction=Direction.OUTPUT, output_value=Value.ACTIVE)},
        )
        try:
            self.request.set_value(offset, Value.INACTIVE)
            time.sleep(0.02)
            if self.request.get_value(offset) == Value.ACTIVE:
                self.request.reconfigure_lines({offset: gpiod.LineSettings(
                    direction=Direction.INPUT, bias=Bias.PULL_DOWN)})
                time.sleep(0.02)
                self.mode = "pull-down"
                if self.request.get_value(offset) == Value.ACTIVE:
                    self.mode = "output"
                    self.request.reconfigure_lines({offset: gpiod.LineSettings(
                        direction=Direction.OUTPUT, output_value=Value.ACTIVE)})
                    print(f"[HatPlusLED] WARNING: BCM {offset} cannot reach LOW; "
                          "check the LED wiring/GPIO hardware.",
                          file=sys.stderr, flush=True)
            self.set_value(1)
        except Exception:
            self.release()
            raise
        print(f"[HatPlusLED] BCM {offset} uses {self.mode}.",
              file=sys.stderr, flush=True)

    def set_value(self, value):
        if self.value == value:
            return
        if self.line is not None:
            self.line.set_value(value)
        else:
            from gpiod.line import Bias, Direction, Value

            if self.mode == "pull-down":
                settings = gpiod.LineSettings(
                    direction=Direction.OUTPUT, output_value=Value.ACTIVE,
                ) if value else gpiod.LineSettings(
                    direction=Direction.INPUT, bias=Bias.PULL_DOWN,
                )
                self.request.reconfigure_lines({self.offset: settings})
            else:
                self.request.set_value(self.offset, Value.ACTIVE if value else Value.INACTIVE)
        self.value = value

    def release(self):
        if self.line is not None:
            self.line.release()
        if self.request is not None:
            self.request.release()


class RgbLed:
    """Drive the active-low RGB LED without initializing the LCD or backlight."""

    def __init__(self, chip):
        self.lines = []
        self.channels = []
        try:
            for offset in (25, 24, 23):  # BCM red, green, blue
                line = LedLine(chip, offset)
                self.lines.append(line)
                line.set_value(1)
                channel = SoftPWM(line.set_value, 100, stop_value=1)
                self.channels.append(channel)
                channel.start(100)
        except Exception:
            self.close()
            raise

    def update(self, color):
        if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise ValueError(f"Invalid RGB color: {color!r}")
        for channel, start in zip(self.channels, (1, 3, 5)):
            value = int(color[start:start + 2], 16)
            channel.ChangeDutyCycle(100 - value / 255 * 100)

    def close(self):
        for channel in self.channels:
            channel.stop()
        for line in self.lines:
            try:
                line.set_value(1)
            finally:
                line.release()


def _read_updates(buffer, led):
    try:
        chunk = os.read(sys.stdin.fileno(), 65536)
    except BlockingIOError:
        return buffer, True
    if not chunk:
        return buffer, False
    lines = (buffer + chunk).split(b"\n")
    for line in lines[:-1]:
        try:
            message = json.loads(line)
            if led is not None and "RGB" in message:
                led.update(message["RGB"])
        except (ValueError, TypeError) as error:
            print(f"[HatPlusLED] {error}", file=sys.stderr, flush=True)
    return lines[-1], True


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
    led = None
    try:
        try:
            led = RgbLed(chip)
            print("[HatPlusLED] RGB controller ready (BCM 25/24/23).",
                  file=sys.stderr, flush=True)
        except Exception as error:
            print(f"[HatPlusLED] LED initialization failed: {error}",
                  file=sys.stderr, flush=True)
        os.set_blocking(sys.stdin.fileno(), False)
        buffer = b""
        stable_value = read_value()
        candidate_value = stable_value
        candidate_since = time.monotonic()
        while RUNNING:
            buffer, connected = _read_updates(buffer, led)
            if not connected:
                break
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
        if led is not None:
            led.close()
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
