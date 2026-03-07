#!/usr/bin/env python3
"""Test how many multi-turn conversation rounds hailo-vlm can handle."""
import requests
import base64
import json
import time
import sys
import io

VLM_URL = "http://localhost:8808/v1/chat/completions"

# Create a small test image (red square)
from PIL import Image

img = Image.new("RGB", (64, 64), color=(255, 0, 0))
buf = io.BytesIO()
img.save(buf, format="JPEG")
IMG_B64 = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()

# Conversation with incrementally growing history
messages = []
questions = [
    # Round 1: image + question
    {"with_image": True, "text": "What color is this image?"},
    # Round 2+: follow-up text questions
    {"with_image": False, "text": "What emotions does that color represent?"},
    {"with_image": False, "text": "Name 3 fruits of the same color."},
    {"with_image": False, "text": "Which of those fruits is the sweetest?"},
    {"with_image": False, "text": "How would you describe the taste of that fruit?"},
    {"with_image": False, "text": "What desserts can be made with it?"},
    {"with_image": False, "text": "Give me a simple recipe for one of those desserts."},
    {"with_image": False, "text": "What temperature should the oven be set to?"},
    {"with_image": False, "text": "How long should it bake?"},
    {"with_image": False, "text": "What should I serve it with?"},
    {"with_image": False, "text": "Summarize our entire conversation in 3 sentences."},
    {"with_image": False, "text": "Now summarize it in just 1 sentence."},
    {"with_image": False, "text": "Rate this conversation from 1 to 10."},
    {"with_image": False, "text": "Why did you give that rating?"},
    {"with_image": False, "text": "What could make it better?"},
    {"with_image": False, "text": "Tell me a joke about the fruit we discussed."},
    {"with_image": False, "text": "Explain why that joke is funny."},
    {"with_image": False, "text": "What is the nutritional value of that fruit?"},
    {"with_image": False, "text": "Is it good for weight loss?"},
    {"with_image": False, "text": "Final question: what was the original color of the image I showed you?"},
]

for i, q in enumerate(questions):
    round_num = i + 1

    if q["with_image"]:
        user_msg = {
            "role": "user",
            "content": [
                {"type": "text", "text": q["text"]},
                {"type": "image_url", "image_url": {"url": IMG_B64}},
            ],
        }
    else:
        user_msg = {"role": "user", "content": q["text"]}

    messages.append(user_msg)

    payload = {"model": "hailo-vlm", "messages": list(messages)}
    payload_size = len(json.dumps(payload))

    print(
        f"\n--- Round {round_num} (history: {len(messages)} msgs, payload: {payload_size} bytes) ---"
    )
    print(f"Q: {q['text']}")

    t0 = time.time()
    try:
        resp = requests.post(VLM_URL, json=payload, timeout=120)
        elapsed = time.time() - t0

        if resp.status_code != 200:
            print(f"ERROR (HTTP {resp.status_code}, {elapsed:.1f}s): {resp.text[:200]}")
            print(f"\n=== FAILED at round {round_num} ===")
            sys.exit(0)

        data = resp.json()
        if "error" in data:
            print(f"ERROR ({elapsed:.1f}s): {data['error']}")
            print(f"\n=== FAILED at round {round_num} ===")
            sys.exit(0)

        answer = data["choices"][0]["message"]["content"]
        print(f"A ({elapsed:.1f}s): {answer[:200]}")

        # Add assistant reply to history
        messages.append({"role": "assistant", "content": answer})

    except Exception as e:
        elapsed = time.time() - t0
        print(f"EXCEPTION ({elapsed:.1f}s): {e}")
        print(f"\n=== FAILED at round {round_num} ===")
        sys.exit(0)

print(f"\n=== ALL {len(questions)} ROUNDS COMPLETED SUCCESSFULLY ===")
