"""
Hailo VLM HTTP Service  (OpenAI-compatible Vision API)
-------------------------------------------------------
Wraps the Hailo-10H VLM (Vision Language Model) as an OpenAI-compatible
/v1/chat/completions endpoint so that Whisplay can use it via
  VISION_SERVER=openai
  OPENAI_API_BASE_URL=http://localhost:8808/v1
  OPENAI_VISION_MODEL=hailo-vlm

Prerequisites:
  sudo apt install hailo-all
  pip install hailo-apps[gen-ai] opencv-python-headless --break-system-packages
  hailo-download-resources --group vlm_chat --arch hailo10h

Usage:
  python3 hailo-vlm-host.py [--port 8808]
"""

import argparse
import base64
import io
import os
import sys
import time
import traceback
import uuid

import cv2
import numpy as np
from flask import Flask, jsonify, request

# ── Hailo imports ─────────────────────────────────────────────────────────────
try:
    from hailo_platform import VDevice
    from hailo_platform.genai import VLM
    from hailo_apps.python.core.common.core import resolve_hef_path
    from hailo_apps.python.core.common.defines import (
        HAILO10H_ARCH,
        SHARED_VDEVICE_GROUP_ID,
        VLM_CHAT_APP,
    )
    HAILO_AVAILABLE = True
except ImportError as _e:
    HAILO_AVAILABLE = False
    print(f"[WARN] Hailo platform not available ({_e}). Vision responses will be empty.")

# ── Pillow for base64 image decoding ─────────────────────────────────────────
try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

# ── CLI args ──────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="Hailo VLM HTTP Service (OpenAI-compatible)")
parser.add_argument("--port", type=int, default=int(os.getenv("HAILO_VLM_PORT", "8808")))
parser.add_argument("--host", type=str, default="0.0.0.0")
parser.add_argument("--max-tokens", type=int, default=512)
parser.add_argument("--temperature", type=float, default=0.3)
parser.add_argument("--hef-path", type=str, default=None, help="Path to VLM HEF model")
args = parser.parse_args()

# ── Model initialisation ──────────────────────────────────────────────────────
app = Flask(__name__)
vdevice = None
vlm = None
_hef_path = None  # cached HEF path for re-init


def _init_vlm():
    """(Re-)create the VDevice + VLM.  Returns (vdevice, vlm)."""
    global _hef_path
    print("[INIT] Initialising Hailo device …")
    params = VDevice.create_params()
    params.group_id = SHARED_VDEVICE_GROUP_ID
    _vdevice = VDevice(params)
    print("[INIT] Hailo device ready")

    if _hef_path is None:
        _hef_path = args.hef_path or resolve_hef_path(
            hef_path=None, app_name=VLM_CHAT_APP, arch=HAILO10H_ARCH
        )
    if _hef_path is None:
        print(
            "[ERROR] VLM HEF not found. "
            "Run: hailo-download-resources --group vlm_chat --arch hailo10h"
        )
        sys.exit(1)

    print("[INIT] Loading VLM model …")
    t0 = time.perf_counter()
    _vlm = VLM(_vdevice, str(_hef_path))
    print(f"[INIT] VLM loaded in {time.perf_counter() - t0:.2f}s")
    return _vdevice, _vlm


def _reinit_vlm(reason: str = ""):
    """Release current VLM/VDevice and create fresh ones."""
    global vdevice, vlm
    tag = f" ({reason})" if reason else ""
    print(f"[RECOVERY] Re-initialising VLM{tag} …")
    # Release old resources
    for obj in (vlm, vdevice):
        if obj is not None:
            try:
                obj.release()
            except Exception:
                pass
    vlm = None
    vdevice = None
    vdevice, vlm = _init_vlm()
    print("[RECOVERY] VLM re-initialised successfully")


if HAILO_AVAILABLE:
    try:
        vdevice, vlm = _init_vlm()
        print(f"[INIT] Ready on port {args.port}")
    except Exception as exc:
        print(f"[ERROR] Failed to initialise Hailo VLM: {exc}")
        sys.exit(1)
else:
    print(f"[WARN] Starting in stub mode (hailo_platform unavailable) on port {args.port}")


# ── Helpers ───────────────────────────────────────────────────────────────────

VLM_IMAGE_SIZE = 336  # Required resolution for Hailo VLM
DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant that analyzes images and answers questions about them."


def _decode_base64_image(b64_str: str) -> np.ndarray:
    """Decode a base64-encoded image (data-URI or raw) to a 336x336 RGB numpy array."""
    # Strip data-URI prefix if present
    if "," in b64_str:
        b64_str = b64_str.split(",", 1)[1]

    img_bytes = base64.b64decode(b64_str)

    if PIL_AVAILABLE:
        pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        pil_img = pil_img.resize((VLM_IMAGE_SIZE, VLM_IMAGE_SIZE), Image.LANCZOS)
        img = np.array(pil_img, dtype=np.uint8)
    else:
        arr = np.frombuffer(img_bytes, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Could not decode image bytes")
        img = cv2.resize(img, (VLM_IMAGE_SIZE, VLM_IMAGE_SIZE), interpolation=cv2.INTER_LINEAR)
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.uint8)

    return img


def _build_hailo_prompt(messages) -> tuple[list[dict], list[np.ndarray]]:
    """
    Convert OpenAI-style messages to Hailo VLM prompt format.
    Returns (prompt_list, frames_list).

    Handles non-standard payloads produced by OPENAI_USE_SINGLE_MESSAGE_PAYLOAD:
      - messages may be a dict instead of a list (wraps it automatically)
      - image_url value may be a plain data-URI string instead of {"url": "..."}
    """
    # Normalise: some clients send a single message dict instead of a list
    if isinstance(messages, dict):
        messages = [messages]

    prompt: list[dict] = []
    frames: list[np.ndarray] = []

    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")

        text_parts: list[dict] = []
        image_parts: list[dict] = []   # collected separately so image comes first
        frame_buf: list[np.ndarray] = []

        if isinstance(content, str):
            text_parts.append({"type": "text", "text": content})
        elif isinstance(content, list):
            for part in content:
                ptype = part.get("type", "")
                if ptype == "text":
                    text_parts.append({"type": "text", "text": part.get("text", "")})
                elif ptype == "image_url":
                    # image_url may be a dict {"url": "..."} or a bare data-URI string
                    image_url_val = part.get("image_url", {})
                    if isinstance(image_url_val, str):
                        url = image_url_val
                    elif isinstance(image_url_val, dict):
                        url = image_url_val.get("url", "")
                    else:
                        url = ""
                    if url.startswith("data:"):
                        img = _decode_base64_image(url)
                        frame_buf.append(img)
                        image_parts.append({"type": "image"})
                    else:
                        print(f"[WARN] Remote image URLs are not supported, skipping: {url[:60]}")

        # Hailo VLM expects image tokens BEFORE text tokens (per official example)
        hailo_content = image_parts + text_parts
        frames.extend(frame_buf)
        prompt.append({"role": role, "content": hailo_content})

    return prompt, frames


def _make_openai_response(content: str, model: str) -> dict:
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/v1/models", methods=["GET"])
def list_models():
    return jsonify(
        {
            "object": "list",
            "data": [{"id": "hailo-vlm", "object": "model", "owned_by": "hailo"}],
        }
    )


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "hailo": HAILO_AVAILABLE, "vlm_loaded": vlm is not None})


@app.route("/v1/chat/completions", methods=["POST"])
def chat_completions():
    data = request.get_json(force=True, silent=True) or {}

    messages = data.get("messages", [])
    # Normalise single-message dict to list (OPENAI_USE_SINGLE_MESSAGE_PAYLOAD compat)
    if isinstance(messages, dict):
        messages = [messages]
    max_tokens: int = int(data.get("max_tokens") or args.max_tokens)
    temperature: float = float(data.get("temperature") or args.temperature)
    model: str = data.get("model", "hailo-vlm")

    if not HAILO_AVAILABLE or vlm is None:
        return jsonify(_make_openai_response("", model))

    # Ensure a system prompt exists (required by Hailo VLM for proper behavior)
    has_system = any(m.get("role") == "system" for m in messages if isinstance(m, dict))
    if not has_system:
        messages.insert(0, {"role": "system", "content": DEFAULT_SYSTEM_PROMPT})

    # ── Truncate history to the most recent turns ─────────────────────────
    # The small on-device VLM (~1-3B params) degrades rapidly when the prompt
    # exceeds ~3 user turns (garbled / repetitive output).  Keep only:
    #   - system prompt(s)
    #   - the first user message that contains an image (visual anchor)
    #   - the most recent MAX_CONTEXT_TURNS user/assistant pairs
    MAX_CONTEXT_TURNS = 3
    non_system = [m for m in messages if m.get("role") != "system"]
    system_msgs = [m for m in messages if m.get("role") == "system"]
    user_count = sum(1 for m in non_system if m.get("role") == "user")

    if user_count > MAX_CONTEXT_TURNS:
        # Locate the first message containing an image
        first_image_msg = None
        for m in non_system:
            content = m.get("content", "")
            if isinstance(content, list) and any(
                p.get("type") == "image_url" for p in content
            ):
                first_image_msg = m
                break

        # Keep only the tail of the conversation
        recent = non_system[-(MAX_CONTEXT_TURNS * 2):]
        trimmed = list(system_msgs)
        if first_image_msg and first_image_msg not in recent:
            trimmed.append(first_image_msg)
        trimmed.extend(recent)
        print(
            f"[VLM] Trimmed history: {len(messages)} → {len(trimmed)} msgs "
            f"({user_count} user turns, keeping last {MAX_CONTEXT_TURNS})"
        )
        messages = trimmed

    prompt, frames = _build_hailo_prompt(messages)

    # VLM.generate_all() requires 'frames' — supply a neutral gray image if
    # none provided (all-black zeros cause HAILO_INVALID_OPERATION).
    # Also inject an {"type": "image"} token into the prompt so that the
    # frame count matches the prompt's image token count.
    if not frames:
        gray = np.full((VLM_IMAGE_SIZE, VLM_IMAGE_SIZE, 3), 128, dtype=np.uint8)
        frames = [gray]
        # Find the first user message and prepend an image token
        for entry in prompt:
            if entry.get("role") == "user":
                entry["content"].insert(0, {"type": "image"})
                break

    # ── Always clear VLM KV-cache before generation ─────────────────────
    # Each request carries the full (truncated) history in the prompt, so
    # stale KV-cache from prior requests only adds noise.
    try:
        if vlm:
            vlm.clear_context()
    except Exception:
        pass

    # Attempt generation with one automatic retry after re-init on NPU errors
    for attempt in range(2):
        try:
            raw_response: str = vlm.generate_all(
                prompt=prompt,
                frames=frames,
                temperature=temperature,
                max_generated_tokens=max_tokens,
            )

            # Clean up model artefacts
            clean = raw_response.split(". [{'type'")[0].split("<|im_end|>")[0].strip()
            return jsonify(_make_openai_response(clean, model))

        except Exception as exc:
            traceback.print_exc()  # log full traceback to stderr / journal
            exc_name = type(exc).__name__
            is_npu_error = "InvalidOperation" in exc_name or "HAILO_INVALID_OPERATION" in str(exc)

            if is_npu_error and attempt == 0:
                # NPU generator is in a broken state — reinitialise and retry
                try:
                    _reinit_vlm(reason=exc_name)
                    continue  # retry with fresh VLM
                except Exception as reinit_exc:
                    print(f"[ERROR] VLM re-init failed: {reinit_exc}")
                    return jsonify({"error": {"message": f"VLM re-init failed: {reinit_exc}", "type": "server_error"}}), 500

            return jsonify({"error": {"message": str(exc), "type": "server_error"}}), 500


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import signal

    def _shutdown(sig, frame):
        global vdevice, vlm
        print("\n[SHUTDOWN] Releasing Hailo resources …")
        if vlm:
            try:
                vlm.clear_context()
                vlm.release()
            except Exception:
                pass
        if vdevice:
            try:
                vdevice.release()
            except Exception:
                pass
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    app.run(host=args.host, port=args.port, threaded=False)
