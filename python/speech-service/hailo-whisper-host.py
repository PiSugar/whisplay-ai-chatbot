"""
Hailo Whisper ASR HTTP Service
-------------------------------
Provides a Flask HTTP endpoint for Whisper speech recognition
using the Hailo-10H NPU (AI Hat+ 2).

Compatible with the same /recognize API as faster-whisper-host.py
and llm8850-whisper.

Prerequisites:
  sudo apt install hailo-all
  pip install hailo-apps[gen-ai] --break-system-packages
  hailo-download-resources --group whisper_chat --arch hailo10h

Usage:
  python3 hailo-whisper-host.py [--port 8807] [--language en] [--hef-path /path/to/model.hef]
"""

import argparse
import base64
import os
import sys
import tempfile
import time
import wave

import numpy as np
from flask import Flask, jsonify, request

# ── Hailo imports ────────────────────────────────────────────────────────────
try:
    from hailo_platform import VDevice
    from hailo_platform.genai import Speech2Text, Speech2TextTask
    from hailo_apps.python.core.common.core import resolve_hef_path
    from hailo_apps.python.core.common.defines import (
        HAILO10H_ARCH,
        SHARED_VDEVICE_GROUP_ID,
        WHISPER_CHAT_APP,
    )
    HAILO_AVAILABLE = True
except ImportError as _e:
    HAILO_AVAILABLE = False
    print(f"[WARN] Hailo platform not available ({_e}). Service will return empty transcriptions.")

# ── CLI args ─────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="Hailo Whisper ASR HTTP Service")
parser.add_argument("--port", type=int, default=int(os.getenv("HAILO_WHISPER_PORT", "8807")))
parser.add_argument("--host", type=str, default="0.0.0.0")
parser.add_argument("--language", type=str, default=os.getenv("HAILO_WHISPER_LANGUAGE", "en"))
parser.add_argument("--timeout-ms", type=int, default=15000)
parser.add_argument("--hef-path", type=str, default=None, help="Path to Whisper HEF model")
args = parser.parse_args()

DEFAULT_LANGUAGE = args.language

# ── Model initialisation ──────────────────────────────────────────────────────
app = Flask(__name__)
vdevice = None
speech2text = None

if HAILO_AVAILABLE:
    try:
        print("[INIT] Initialising Hailo device …")
        params = VDevice.create_params()
        params.group_id = SHARED_VDEVICE_GROUP_ID
        vdevice = VDevice(params)
        print("[INIT] Hailo device ready")

        print("[INIT] Loading Whisper model …")
        hef_path = args.hef_path or resolve_hef_path(
            hef_path=None, app_name=WHISPER_CHAT_APP, arch=HAILO10H_ARCH
        )
        if hef_path is None:
            print(
                "[ERROR] Whisper HEF not found. "
                "Run: hailo-download-resources --group whisper_chat --arch hailo10h"
            )
            sys.exit(1)

        t0 = time.perf_counter()
        speech2text = Speech2Text(vdevice, str(hef_path))
        print(f"[INIT] Model loaded in {time.perf_counter() - t0:.2f}s — ready on port {args.port}")
    except Exception as exc:
        print(f"[ERROR] Failed to initialise Hailo Whisper: {exc}")
        sys.exit(1)
else:
    print(f"[WARN] Starting in stub mode (hailo_platform unavailable) on port {args.port}")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_wav_as_float32(wav_path: str) -> tuple[np.ndarray, int]:
    """Read a WAV file and return float32 audio data + sample rate."""
    with wave.open(wav_path, "rb") as wf:
        sample_rate = wf.getframerate()
        n_channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        raw = wf.readframes(wf.getnframes())

    dtype_map = {1: np.int8, 2: np.int16, 4: np.int32}
    dtype = dtype_map.get(sample_width, np.int16)
    audio = np.frombuffer(raw, dtype=dtype)

    # Downmix to mono
    if n_channels > 1:
        audio = audio.reshape(-1, n_channels).mean(axis=1)

    # Normalise to [-1, 1] float32 little-endian
    max_val = float(2 ** (sample_width * 8 - 1))
    audio = (audio.astype(np.float32) / max_val).astype("<f4")
    return audio, sample_rate


def _b64_to_temp_wav(b64: str) -> str:
    """Write base64-encoded audio bytes to a temporary WAV file."""
    raw = base64.b64decode(b64)
    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    with open(path, "wb") as fh:
        fh.write(raw)
    return path


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "hailo": HAILO_AVAILABLE})


@app.route("/recognize", methods=["POST"])
def recognize():
    data = request.get_json(force=True, silent=True) or {}

    file_path: str | None = data.get("filePath")
    b64_audio: str | None = data.get("base64")
    language: str = data.get("language") or DEFAULT_LANGUAGE

    if not file_path and not b64_audio:
        return jsonify({"error": "Either filePath or base64 is required"}), 400

    if not HAILO_AVAILABLE or speech2text is None:
        return jsonify({"recognition": "", "language": language, "time_cost": 0})

    temp_file: str | None = None
    try:
        t0 = time.perf_counter()

        # Resolve audio file path
        if file_path:
            audio_path = file_path
        else:
            temp_file = _b64_to_temp_wav(b64_audio)
            audio_path = temp_file

        audio_data, _sr = _load_wav_as_float32(audio_path)

        segments = speech2text.generate_all_segments(
            audio_data=audio_data,
            task=Speech2TextTask.TRANSCRIBE,
            language=language,
            timeout_ms=args.timeout_ms,
        )

        text = "".join(seg.text for seg in segments).strip() if segments else ""
        elapsed = round(time.perf_counter() - t0, 3)

        return jsonify({"recognition": text, "language": language, "time_cost": elapsed})

    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    finally:
        if temp_file and os.path.exists(temp_file):
            try:
                os.remove(temp_file)
            except OSError:
                pass


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import signal

    def _shutdown(sig, frame):
        global vdevice
        print("\n[SHUTDOWN] Releasing Hailo device …")
        if vdevice:
            try:
                vdevice.release()
            except Exception:
                pass
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    app.run(host=args.host, port=args.port, threaded=False)
