# whisplay-im Bridge

## Overview

Use `whisplay-im` to connect OpenClaw to a Whisplay device as a pure IM bridge.
The device pushes ASR text into the bridge. OpenClaw polls for new messages and
sends replies back for TTS playback. Supports image sending in both directions via base64.

## Inputs to collect

- Bridge base URL (host/port)
- Auth token for `Authorization: Bearer <token>`
- Optional `waitSec` for long-polling

## Actions

### Send device ASR text (inbox)

This api is called by the device to push ASR text into the bridge.
Optionally include `imageBase64` (base64 data URL) to attach a captured image.

```bash
# Text only
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message":"hello","messages":[{"role":"user","content":"hello"}]}' \
  http://<device-host>:18888/whisplay-im/inbox

# Text with image (base64)
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message":"what is this?","messages":[{"role":"user","content":"what is this?"}],"imageBase64":"data:image/jpeg;base64,/9j/4AAQ..."}' \
  http://<device-host>:18888/whisplay-im/inbox
```

### Poll for a new message

This api is called by OpenClaw to poll for new messages from the device. It supports long-polling with `waitSec` parameter.
If an image was attached, the response will include `imageBase64` (base64 data URL).

```bash
curl -X GET \
  -H "Authorization: Bearer <token>" \
  "http://<device-host>:18888/whisplay-im/poll?waitSec=30"
```

Response example (with image):
```json
{"message":"what is this?","messages":[{"role":"user","content":"what is this?"}],"imageBase64":"data:image/jpeg;base64,/9j/4AAQ..."}
```

### Send reply to device

This api is called by OpenClaw to send a reply back to the device for TTS playback.
Optionally include `imageBase64` to display an image on the device (e.g. generated image).

```bash
# Text reply
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"reply":"Hello from OpenClaw","emoji":"🦞"}' \
  http://<device-host>:18888/whisplay-im/send

# Reply with image
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"reply":"Here is the generated image","emoji":"🎨","imageBase64":"data:image/png;base64,iVBOR..."}' \
  http://<device-host>:18888/whisplay-im/send
```

## Image Support

All images are transmitted as base64 data URLs (`data:image/<format>;base64,...`).

### Device → OpenClaw (USE_CAPTURED_IMAGE_IN_CHAT)

When `USE_CAPTURED_IMAGE_IN_CHAT=true` is set in the chatbot `.env`:

1. Device captures an image (camera double-click)
2. On next voice input, the image is attached as `imageBase64` in the inbox payload
3. OpenClaw polls the message and receives `imageBase64`
4. The plugin forwards the base64 data as `MediaUrl` to the OpenClaw agent for multimodal processing

### OpenClaw → Device (Image Generation)

When the agent generates or sends an image:

1. The plugin converts the image URL to base64 and sends `imageBase64` in the `/whisplay-im/send` payload
2. The bridge saves the base64 image to local `data/images/`
3. The device displays the image on screen

## Notes

- `messages` is optional; use it for context routing.
- `poll` returns an empty payload if no messages are available.
- `send` supports optional `emoji` to control the device display.
- `imageBase64` is optional in all endpoints and must be a base64-encoded data URL.

