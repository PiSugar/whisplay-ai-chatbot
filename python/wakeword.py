import os
import re
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


def detect_alsa_input_device():
    configured = os.getenv("WAKE_WORD_ALSA_DEVICE") or os.getenv("ALSA_INPUT_DEVICE")
    if configured:
        return configured

    card_ref = os.getenv("SOUND_CARD_NAME") or os.getenv("SOUND_CARD_INDEX")
    if not card_ref:
        try:
            with open("/proc/asound/cards", "r", encoding="utf-8") as cards_file:
                for line in cards_file:
                    if re.search(r"whisplaysound|wm8960soundcard|es8389soundcard", line, re.I):
                        name_match = re.search(r"\[([^\]]+)\]", line)
                        index_match = re.match(r"\s*(\d+)\s+\[", line)
                        if name_match:
                            card_ref = name_match.group(1).strip()
                        elif index_match:
                            card_ref = index_match.group(1)
                        break
        except OSError:
            pass

    return f"hw:{card_ref},0" if card_ref else "default"


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

    alsa_input_device = detect_alsa_input_device()
    print(f"[WakeWord] Using ALSA input device: {alsa_input_device}")

    sox_cmd = [
        "sox",
        "-q",
        "-t",
        "alsa",
        alsa_input_device,
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

    process = None

    def stop_recorder():
        if process is None or process.poll() is not None:
            return
        try:
            process.terminate()
            process.wait(timeout=1.0)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=1.0)
        except OSError:
            pass

    def cleanup(*_):
        stop_recorder()
        sys.exit(0)

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)

    process = subprocess.Popen(
        sox_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

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
            if process.poll() is not None:
                error = process.stderr.read().decode(errors="replace").strip() if process.stderr else ""
                if error:
                    print(f"[WakeWord] Audio capture failed: {error}", file=sys.stderr)
                sys.exit(process.returncode or 1)
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
                # Release the exclusive ALSA capture device before Node starts
                # recording the user's question.
                stop_recorder()
                print(f"WAKE {keyword} {score:.3f}", flush=True)
                return


if __name__ == "__main__":
    main()
