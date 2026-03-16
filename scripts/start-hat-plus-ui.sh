#!/bin/bash
# Start browser in kiosk mode for the Whisplay Hat Plus DSI display (480x640)
# This script waits for the Hat Plus web server to become available,
# then launches a browser in fullscreen kiosk mode on the local display.

HAT_PLUS_PORT="${WHISPLAY_HAT_PLUS_PORT:-17881}"
HAT_PLUS_URL="http://localhost:${HAT_PLUS_PORT}/"
MAX_WAIT=60

# Detect display server: Wayland (labwc) or X11
if [ -S "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/wayland-0" ]; then
  DISPLAY_SERVER="wayland"
  export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  export MOZ_ENABLE_WAYLAND=1
else
  DISPLAY_SERVER="x11"
  export DISPLAY="${DISPLAY:-:0}"
fi
echo "[hat-plus-ui] Display server: ${DISPLAY_SERVER}"

echo "[hat-plus-ui] Waiting for web server at ${HAT_PLUS_URL} ..."

waited=0
while ! curl -s -o /dev/null -w "%{http_code}" "$HAT_PLUS_URL" 2>/dev/null | grep -q "200"; do
  sleep 1
  waited=$((waited + 1))
  if [ "$waited" -ge "$MAX_WAIT" ]; then
    echo "[hat-plus-ui] Timeout waiting for web server after ${MAX_WAIT}s"
    exit 1
  fi
done

echo "[hat-plus-ui] Server is ready, launching browser kiosk ..."

# Kill any existing browser instances targeting our URL
pkill -f "chromium.*${HAT_PLUS_PORT}" 2>/dev/null || true
pkill -f "firefox.*${HAT_PLUS_PORT}" 2>/dev/null || true
sleep 1

# Prefer Chromium, fall back to Firefox
BROWSER_BIN=""
if command -v chromium &>/dev/null; then
  BROWSER_BIN="chromium"
elif command -v chromium-browser &>/dev/null; then
  BROWSER_BIN="chromium-browser"
elif command -v firefox &>/dev/null; then
  BROWSER_BIN="firefox"
else
  echo "[hat-plus-ui] Error: no browser found. Install chromium or firefox"
  exit 1
fi

echo "[hat-plus-ui] Using browser: ${BROWSER_BIN}"

if [ "$BROWSER_BIN" = "firefox" ]; then
  exec firefox --kiosk "$HAT_PLUS_URL"
else
  CHROMIUM_ARGS=(
    --kiosk
    --noerrdialogs
    --disable-infobars
    --no-first-run
    --start-fullscreen
    --disable-translate
    --disable-features=TranslateUI
    --disable-session-crashed-bubble
    --disable-component-update
    --disable-restore-session-state
    --autoplay-policy=no-user-gesture-required
    --check-for-update-interval=31536000
    --window-size=480,640
    --window-position=0,0
  )

  if [ "$DISPLAY_SERVER" = "wayland" ]; then
    CHROMIUM_ARGS+=(--ozone-platform=wayland)
  fi

  exec "$BROWSER_BIN" "${CHROMIUM_ARGS[@]}" "$HAT_PLUS_URL"
fi
