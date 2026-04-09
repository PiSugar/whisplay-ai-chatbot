"""JSON configuration loader for ChatWin.

The config file is a plain JSON document whose shape is documented in
``config.example.json``. Unknown keys are preserved so downstream modules
can read them if needed. Missing sections fall back to sensible defaults.
"""

from __future__ import annotations

import copy
import json
import os
from typing import Any, Dict


DEFAULT_CONFIG: Dict[str, Any] = {
    "button": {
        "pin": 17,
        "pull_up": True,
        "active_low": True,
        "bounce_time_ms": 50,
        "hold_to_talk": True,
    },
    "web_display": {
        "host": "0.0.0.0",
        "port": 8080,
        "title": "ChatWin",
        "show_conversation": True,
    },
    "audio": {
        "sample_rate": 16000,
        "channels": 1,
        "record_device": "default",
        "playback_device": "default",
        "record_format": "S16_LE",
        "max_record_seconds": 60,
    },
    "stt": {
        "model_size_or_path": "tiny",
        "device": "cpu",
        "compute_type": "int8",
        "cpu_threads": 3,
        "language": "en",
        "vad_filter": True,
    },
    "llm": {
        "enabled": True,
        "api_key": "",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
        "system_prompt": (
            "You are ChatWin, a friendly voice assistant running on a "
            "Raspberry Pi. Answer briefly and conversationally in at most "
            "three sentences."
        ),
        "max_history": 10,
        "request_timeout": 60,
        "stream": True,
    },
    "tts": {
        "enabled": True,
        "api_key": "",
        "base_url": "https://api.openai.com/v1",
        "model": "tts-1",
        "voice": "alloy",
        "response_format": "wav",
        "request_timeout": 60,
    },
}


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively merge ``override`` into ``base`` without mutating inputs."""
    result = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if (
            key in result
            and isinstance(result[key], dict)
            and isinstance(value, dict)
        ):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def load_config(path: str) -> Dict[str, Any]:
    """Load and validate a ChatWin config from ``path``.

    The returned dict has every default section populated.
    """
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Config file not found: {path}")

    with open(path, "r", encoding="utf-8") as f:
        try:
            user_config = json.load(f)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"Config file {path} is not valid JSON: {exc}"
            ) from exc

    if not isinstance(user_config, dict):
        raise ValueError(f"Config file {path} must contain a JSON object")

    merged = _deep_merge(DEFAULT_CONFIG, user_config)
    merged["_config_path"] = os.path.abspath(path)
    return merged


def get_section(config: Dict[str, Any], name: str) -> Dict[str, Any]:
    """Return the named section as a dict, even if it was omitted."""
    section = config.get(name)
    if not isinstance(section, dict):
        return {}
    return section
