#!/usr/bin/env bash
# test_music_playback.sh — Automated test for music playback coexistence
#
# Tests that music playback via mpg123/sox works correctly even when
# the persistent TTS player is active. Simulates the chatbot's audio
# architecture: a persistent mpg123 process feeding TTS audio via stdin,
# and a separate mpg123 process for music files.
#
# Usage:  bash test_music_playback.sh [ALSA_DEVICE]
# Default ALSA_DEVICE: dmixed

set -uo pipefail

ALSA_DEVICE="${1:-dmixed}"
MUSIC_DIR="/home/pi/Music"
PASS=0
FAIL=0
PIDS_TO_KILL=()

cleanup() {
  for pid in "${PIDS_TO_KILL[@]}"; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

log()  { echo "[TEST] $*"; }
pass() { ((PASS++)); echo "[PASS] $*"; }
fail() { ((FAIL++)); echo "[FAIL] $*"; }

# --- Pre-checks ---
log "ALSA device: $ALSA_DEVICE"

MUSIC_FILE=$(find "$MUSIC_DIR" -maxdepth 2 -name '*.mp3' -print -quit 2>/dev/null || true)
if [[ -z "$MUSIC_FILE" ]]; then
  fail "No mp3 files found in $MUSIC_DIR"
  exit 1
fi
log "Music file: $MUSIC_FILE"

if ! command -v mpg123 &>/dev/null; then
  fail "mpg123 not found"
  exit 1
fi

# =========================================================
# Test 1: mpg123 can play a music file via ALSA_DEVICE
# =========================================================
log "--- Test 1: single mpg123 playback ---"
OUTPUT=$(timeout 5 mpg123 -o alsa -a "$ALSA_DEVICE" "$MUSIC_FILE" 2>&1 | head -20)
if echo "$OUTPUT" | grep -q "Playing MPEG stream"; then
  pass "mpg123 plays via $ALSA_DEVICE"
else
  fail "mpg123 cannot play via $ALSA_DEVICE: $OUTPUT"
fi

# =========================================================
# Test 2: sox can play a tone via ALSA_DEVICE
# =========================================================
log "--- Test 2: sox tone playback ---"
SOX_OUT=$(timeout 3 sox -n -t alsa "$ALSA_DEVICE" synth 0.3 sine 440 vol 0.1 2>&1)
SOX_RC=$?
if [[ $SOX_RC -eq 0 ]] || [[ $SOX_RC -eq 124 ]]; then
  pass "sox plays via $ALSA_DEVICE"
else
  fail "sox failed (rc=$SOX_RC): $SOX_OUT"
fi

# =========================================================
# Test 3: mpg123 music works WHILE persistent mpg123 is
#         actively playing (ALSA device held open)
# =========================================================
log "--- Test 3: concurrent persistent-player + music ---"
# Start a persistent mpg123 actually playing audio (forces ALSA device open)
# Generate a 5-second silent mp3 to feed it
SOX_MP3=$(mktemp /tmp/silence_XXXX.mp3)
sox -n -r 44100 -c 1 "$SOX_MP3" synth 5 sine 0 vol 0 2>/dev/null || true
mpg123 --quiet -o alsa -a "$ALSA_DEVICE" "$SOX_MP3" &
PERSISTENT_PID=$!
PIDS_TO_KILL+=("$PERSISTENT_PID")
sleep 1

# Check persistent player is alive and has the device open
if kill -0 "$PERSISTENT_PID" 2>/dev/null; then
  log "Persistent mpg123 actively playing (pid=$PERSISTENT_PID)"
else
  fail "Persistent mpg123 died immediately"
fi

# Now play music concurrently — this is the critical test
MUSIC_OUT=$(timeout 5 mpg123 -o alsa -a "$ALSA_DEVICE" "$MUSIC_FILE" 2>&1 | head -20)
if echo "$MUSIC_OUT" | grep -q "Playing MPEG stream"; then
  if echo "$MUSIC_OUT" | grep -qi "cannot open\|error.*device\|unable to open"; then
    fail "Music started but had device errors: $(echo "$MUSIC_OUT" | grep -i error | head -3)"
  else
    pass "Music plays concurrently with persistent player"
  fi
else
  fail "Music cannot play while persistent player active: $(echo "$MUSIC_OUT" | grep -i error | head -3)"
fi

# Clean up persistent player
kill "$PERSISTENT_PID" 2>/dev/null || true
wait "$PERSISTENT_PID" 2>/dev/null || true
rm -f "$SOX_MP3"
PIDS_TO_KILL=()

# =========================================================
# Test 4: two sequential music tracks play without errors
#         (simulates continuous play / next-track)
# =========================================================
log "--- Test 4: sequential track playback ---"
SEQUENTIAL_OK=true
for i in 1 2 3; do
  OUT=$(timeout 5 mpg123 -o alsa -a "$ALSA_DEVICE" "$MUSIC_FILE" 2>&1 | head -15)
  if echo "$OUT" | grep -qi "cannot open\|error.*device\|unable to open\|failure loading"; then
    fail "Sequential play #$i failed: $(echo "$OUT" | grep -i error | head -1)"
    SEQUENTIAL_OK=false
    break
  fi
done
if $SEQUENTIAL_OK; then
  pass "3 sequential tracks play without device errors"
fi

# =========================================================
# Test 5: music plays after killing persistent player
#         (simulates releaseAudioPlayer → music start)
# =========================================================
log "--- Test 5: music after killing persistent player ---"
SOX_MP3_2=$(mktemp /tmp/silence_XXXX.mp3)
sox -n -r 44100 -c 1 "$SOX_MP3_2" synth 10 sine 0 vol 0 2>/dev/null || true
mpg123 --quiet -o alsa -a "$ALSA_DEVICE" "$SOX_MP3_2" &
P2=$!
PIDS_TO_KILL+=("$P2")
sleep 1

# Kill it (like releaseAudioPlayer does)
kill "$P2" 2>/dev/null || true
wait "$P2" 2>/dev/null || true
rm -f "$SOX_MP3_2"
PIDS_TO_KILL=()
sleep 0.5

# Now play music
AFTER_OUT=$(timeout 5 mpg123 -o alsa -a "$ALSA_DEVICE" "$MUSIC_FILE" 2>&1 | head -15)
if echo "$AFTER_OUT" | grep -q "Playing MPEG stream" && ! echo "$AFTER_OUT" | grep -qi "cannot open"; then
  pass "Music plays after killing persistent player"
else
  fail "Music failed after killing persistent player: $(echo "$AFTER_OUT" | grep -i error | head -2)"
fi

# =========================================================
# Summary
# =========================================================
echo ""
echo "=============================="
echo "  Results: $PASS passed, $FAIL failed"
echo "=============================="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
