#!/usr/bin/env python3
"""ChatWin entry point.

A pure-Python voice AI chatbot for a generic Raspberry Pi. It replaces the
original Whisplay HAT integration with a GPIO-connected push button and a
web-based HTML display, while keeping the rest of the project's ideas
(faster-whisper STT, LLM chat, TTS playback).

Usage:

    python3 start.py [path/to/config.json]

If no path is supplied, ChatWin looks for ``CHATWIN_CONFIG`` in the
environment and then falls back to ``./config.json`` next to this file.
"""

from __future__ import annotations

import os
import signal
import sys
import time

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from chatwin.app import ChatApp  # noqa: E402
from chatwin.config import load_config  # noqa: E402


def _resolve_config_path(argv: list[str]) -> str:
    if len(argv) > 1:
        return os.path.abspath(argv[1])
    env_path = os.environ.get("CHATWIN_CONFIG")
    if env_path:
        return os.path.abspath(env_path)
    return os.path.join(ROOT_DIR, "config.json")


def main() -> int:
    config_path = _resolve_config_path(sys.argv)

    if not os.path.exists(config_path):
        example_path = os.path.join(ROOT_DIR, "config.example.json")
        print(f"[ChatWin] Config file not found: {config_path}")
        if os.path.exists(example_path):
            print(
                f"[ChatWin] Copy {os.path.basename(example_path)} to "
                f"{os.path.basename(config_path)} and fill in your values."
            )
        return 1

    config = load_config(config_path)
    app = ChatApp(config)

    def handle_signal(signum, _frame):
        print(f"\n[ChatWin] Received signal {signum}, shutting down...")
        app.stop()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        app.start()
        while app.running:
            time.sleep(0.5)
    except KeyboardInterrupt:
        app.stop()
    finally:
        app.cleanup()

    return 0


if __name__ == "__main__":
    sys.exit(main())
