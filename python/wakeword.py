import os
import sys
import time
import signal
import subprocess
import numpy as np

try:
    from openwakeword.model import Model
except Exception as e:
    print(f"[WakeWord] Failed to import openwakeword: {e}", file=sys.stderr)
    sys.exit(1)


def parse_list(value: str):
    return [item.strip() for item in value.split(",") if item.strip()]


def main():
    wake_words = parse_list(os.getenv("WAKE_WORDS", ""))
    model_paths = parse_list(os.getenv("WAKE_WORD_MODEL_PATHS", ""))
    threshold = float(os.getenv("WAKE_WORD_THRESHOLD", "0.5"))
    cooldown_sec = float(os.getenv("WAKE_WORD_COOLDOWN_SEC", "1.5"))

    if not wake_words and not model_paths:
        wake_words = ["hey_jarvis"]
        
    print(f"[WakeWord] Using wake words: {wake_words}")

    try:
        model = Model(wakeword_models=model_paths or wake_words)
    except Exception as e:
        print(f"[WakeWord] Failed to initialize model: {e}", file=sys.stderr)
        sys.exit(1)

    sox_cmd = [
        "sox",
        "-t",
        "alsa",
        "default",
        "-r",
        "16000",
        "-b",
        "16",
        "-e",
        "signed-integer",
        "-c",
        "1",
        "-t",
        "raw",
        "-",
    ]

    process = subprocess.Popen(
        sox_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )

    def cleanup(*_):
        try:
            process.terminate()
        except Exception:
            pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)

    last_trigger = 0.0
    chunk_samples = 1280
    chunk_bytes = chunk_samples * 2

    print("[WakeWord] READY", flush=True)

    while True:
        if process.stdout is None:
            time.sleep(0.1)
            continue
        data = process.stdout.read(chunk_bytes)
        if not data or len(data) < chunk_bytes:
            time.sleep(0.01)
            continue

        audio = np.frombuffer(data, dtype=np.int16)
        try:
            prediction = model.predict(audio)
        except Exception:
            continue

        now = time.time()
        if now - last_trigger < cooldown_sec:
            continue

        for keyword, score in prediction.items():
            if score >= threshold:
                last_trigger = now
                print(f"WAKE {keyword} {score:.3f}", flush=True)
                break


if __name__ == "__main__":
    main()
