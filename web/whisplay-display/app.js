const statusText = document.getElementById("statusText");
const emojiText = document.getElementById("emojiText");
const textContent = document.getElementById("textContent");
const batteryFill = document.getElementById("batteryFill");
const batteryText = document.getElementById("batteryText");
const netIcon = document.getElementById("netIcon");
const imageIcon = document.getElementById("imageIcon");
const ragIcon = document.getElementById("ragIcon");
const led = document.getElementById("led");
const ledText = document.getElementById("ledText");
const btn = document.getElementById("btn");
const btnText = document.getElementById("btnText");
const dim = document.getElementById("dim");
const imageLayer = document.getElementById("imageLayer");
const imageDisplay = document.getElementById("imageDisplay");

let scrollTop = 0;
let scrollSpeed = 0;
let scrollTarget = null;
let scrollSyncStart = null;
let scrollSyncDuration = 0;
let scrollSyncFrom = 0;
let lastFrameTime = 0;
let maxScroll = 0;
let lastText = "";
let lastImageRevision = -1;
let isPressed = false;
let activePointerId = null;

function setIconVisible(iconEl, visible) {
  iconEl.style.display = visible ? "block" : "none";
}

function rgb565ToRgb(color) {
  const r = (color >> 11) & 0x1f;
  const g = (color >> 5) & 0x3f;
  const b = color & 0x1f;
  return [
    Math.round((r * 255) / 31),
    Math.round((g * 255) / 63),
    Math.round((b * 255) / 31),
  ];
}

function normalizeColor(value) {
  if (typeof value === "number") {
    const rgb = rgb565ToRgb(value);
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }
  if (typeof value === "string" && value.length > 0) {
    return value.startsWith("#") ? value : `#${value}`;
  }
  return "#44f28a";
}

function applyScrollSync(text, sync, viewportHeight) {
  if (!sync || !text) {
    return;
  }
  const charEnd = Math.max(0, parseInt(sync.char_end || 0, 10));
  const duration = Math.max(1, parseInt(sync.duration_ms || 1, 10));
  const totalChars = text.length || 1;
  const ratio = Math.min(1, charEnd / totalChars);
  maxScroll = Math.max(0, textContent.offsetHeight - viewportHeight);
  scrollTarget = Math.max(scrollTop, Math.round(maxScroll * ratio));
  scrollSyncFrom = scrollTop;
  scrollSyncStart = performance.now();
  scrollSyncDuration = duration;
}

function updateText(text, sync, speed) {
  const viewportHeight = document.querySelector(".text-viewport").offsetHeight;
  const nextText = text || "";
  const isRegressive =
    nextText.length > 0 && nextText.length < lastText.length && lastText.startsWith(nextText);

  if (isRegressive) {
    scrollSpeed = Math.max(0, parseInt(speed || 0, 10));
    applyScrollSync(lastText, sync, viewportHeight);
    maxScroll = Math.max(0, textContent.offsetHeight - viewportHeight);
    return;
  }

  if (nextText !== lastText) {
    const isContinuation = nextText.startsWith(lastText);
    textContent.textContent = nextText;
    if (!isContinuation) {
      scrollTop = 0;
      scrollTarget = null;
      scrollSyncStart = null;
      scrollSyncDuration = 0;
      scrollSyncFrom = 0;
    }
    lastText = nextText;
  }

  scrollSpeed = Math.max(0, parseInt(speed || 0, 10));
  applyScrollSync(lastText, sync, viewportHeight);
  maxScroll = Math.max(0, textContent.offsetHeight - viewportHeight);
}

function animateScroll(timestamp) {
  if (!lastFrameTime) {
    lastFrameTime = timestamp;
  }
  const deltaMs = timestamp - lastFrameTime;
  lastFrameTime = timestamp;

  if (scrollTarget !== null && scrollSyncStart !== null) {
    const elapsed = timestamp - scrollSyncStart;
    const progress = Math.min(1, elapsed / scrollSyncDuration);
    scrollTop = scrollSyncFrom + (scrollTarget - scrollSyncFrom) * progress;
    if (progress >= 1) {
      scrollTarget = null;
      scrollSyncStart = null;
    }
  } else if (scrollSpeed > 0 && scrollTop < maxScroll) {
    const speedPerSec = scrollSpeed * 5;
    scrollTop = Math.min(maxScroll, scrollTop + (speedPerSec * deltaMs) / 1000);
  }

  textContent.style.transform = `translateY(${-scrollTop}px)`;
  requestAnimationFrame(animateScroll);
}

let ws = null;
let reconnectTimer = null;
let cameraTimer = null;

function applyState(data) {
  if (!data || !data.ready) return;

  statusText.textContent = data.status || "";
  emojiText.textContent = data.emoji || "";
  updateText(data.text || "", data.scroll_sync, data.scroll_speed);
  updateTextInputState(data.status);

  const ledColor = normalizeColor(data.RGB);
  led.style.background = ledColor;
  led.style.boxShadow = `0 0 24px ${ledColor}`;
  ledText.textContent = ledColor;

  const batteryLevel = typeof data.battery_level === "number" ? data.battery_level : null;
  if (batteryLevel === null) {
    batteryText.textContent = "--%";
    batteryFill.style.width = "0%";
  } else {
    batteryText.textContent = `${batteryLevel}%`;
    batteryFill.style.width = `${Math.min(100, Math.max(0, batteryLevel))}%`;
  }
  batteryFill.style.background = normalizeColor(data.battery_color);

  setIconVisible(netIcon, Boolean(data.network_connected));
  setIconVisible(imageIcon, Boolean(data.image_icon_visible));
  setIconVisible(ragIcon, Boolean(data.rag_icon_visible));

  const dimOpacity = Math.max(0, Math.min(1, (100 - (data.brightness ?? 100)) / 100));
  dim.style.opacity = dimOpacity.toFixed(2);

  if (data.camera_mode) {
    imageLayer.style.display = "flex";
    startCameraFeed();
    return;
  }

  stopCameraFeed();
  if (data.image && data.image_revision !== lastImageRevision) {
    lastImageRevision = data.image_revision;
    imageDisplay.src = `/image?rev=${lastImageRevision}`;
    imageLayer.style.display = "flex";
  } else if (!data.image) {
    imageLayer.style.display = "none";
  }
}

function startCameraFeed() {
  if (cameraTimer) return;
  cameraTimer = setInterval(() => {
    imageDisplay.src = `/camera?ts=${Date.now()}`;
  }, 200);
}

function stopCameraFeed() {
  if (!cameraTimer) return;
  clearInterval(cameraTimer);
  cameraTimer = null;
}

function connectWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const url = `${protocol}://${window.location.host}/ws`;
  ws = new WebSocket(url);

  ws.addEventListener("message", (event) => {
    let message = null;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "state") {
      applyState(message.payload);
    } else if (message.type === "start_record") {
      startWebAudioRecording();
    } else if (message.type === "stop_record") {
      stopWebAudioRecording();
    } else if (message.type === "play_audio") {
      playWebAudio(message.data, message.format, message.duration, message.playId);
    } else if (message.type === "stop_audio") {
      stopWebAudio();
    } else if (message.type === "start_camera_stream") {
      startWebCameraStream();
    } else if (message.type === "stop_camera_stream") {
      stopWebCameraStream();
    } else if (message.type === "capture_photo") {
      sendWebCameraCapture();
    }
  });

  ws.addEventListener("close", () => {
    stopCameraFeed();
    reconnectTimer = setTimeout(connectWebSocket, 1000);
  });

  ws.addEventListener("error", () => {
    ws.close();
  });
}

function sendButton(action) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "button", action }));
}

connectWebSocket();
requestAnimationFrame(animateScroll);

function setPressed(value) {
  isPressed = value;
  btnText.textContent = isPressed ? "pressed" : "released";
}

const press = () => {
  if (isPressed) return;
  setPressed(true);
  sendButton("press");
};
const release = () => {
  if (!isPressed) return;
  setPressed(false);
  sendButton("release");
};

btn.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  activePointerId = event.pointerId;
  try {
    btn.setPointerCapture(event.pointerId);
  } catch {}
  press();
});

btn.addEventListener("pointerup", (event) => {
  if (activePointerId !== null && event.pointerId !== activePointerId) return;
  release();
  activePointerId = null;
});

btn.addEventListener("pointercancel", (event) => {
  if (activePointerId !== null && event.pointerId !== activePointerId) return;
  release();
  activePointerId = null;
});

btn.addEventListener("lostpointercapture", () => {
  release();
  activePointerId = null;
});

window.addEventListener("pointerup", (event) => {
  if (activePointerId !== null && event.pointerId !== activePointerId) return;
  release();
  activePointerId = null;
});

// ── Web Audio Recording ──────────────────────────────────────────────────────
// When WEB_AUDIO_ENABLED=true on the server, it sends "start_record" /
// "stop_record" commands here. The browser captures with MediaRecorder and
// streams binary frames (prefix byte 0x01) back to the server.

const FRAME_AUDIO   = 0x01;
const FRAME_CAM_LIVE = 0x02;
const FRAME_CAM_CAPTURE = 0x03;

let mediaRecorder = null;
let audioStream = null;
let audioStartInProgress = false;
let stopRequestedBeforeStart = false;
let pendingAudioChunkSends = [];

async function startWebAudioRecording() {
  if (audioStartInProgress) return;
  if (mediaRecorder && mediaRecorder.state !== "inactive") return;
  stopRequestedBeforeStart = false;
  audioStartInProgress = true;
  pendingAudioChunkSends = [];
  updateMicIndicator(true);
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    if (stopRequestedBeforeStart) {
      if (audioStream) {
        audioStream.getTracks().forEach((t) => t.stop());
        audioStream = null;
      }
      updateMicIndicator(false);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "record_complete" }));
      }
      return;
    }

    const preferredMimes = [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/webm",
    ];
    const mimeType = preferredMimes.find((m) => MediaRecorder.isTypeSupported(m)) || "";
    const options = mimeType ? { mimeType } : {};

    mediaRecorder = new MediaRecorder(audioStream, options);

    mediaRecorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const sendTask = event.data.arrayBuffer().then((buf) => {
        const payload = new Uint8Array(1 + buf.byteLength);
        payload[0] = FRAME_AUDIO;
        payload.set(new Uint8Array(buf), 1);
        ws.send(payload);
      });
      pendingAudioChunkSends.push(sendTask);
      sendTask.finally(() => {
        pendingAudioChunkSends = pendingAudioChunkSends.filter(
          (task) => task !== sendTask,
        );
      });
    };

    mediaRecorder.onstop = () => {
      updateMicIndicator(false);
      if (audioStream) {
        audioStream.getTracks().forEach((t) => t.stop());
        audioStream = null;
      }
      mediaRecorder = null;
      Promise.allSettled(pendingAudioChunkSends).finally(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "record_complete" }));
        }
      });
    };

    // Emit data chunks every 500 ms so the server can monitor progress.
    mediaRecorder.start(500);
    if (stopRequestedBeforeStart && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
  } catch (e) {
    console.error("[WebAudio] getUserMedia (audio) failed:", e);
    updateMicIndicator(false);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "record_complete" }));
    }
  } finally {
    audioStartInProgress = false;
  }
}

function stopWebAudioRecording() {
  stopRequestedBeforeStart = true;
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}

function updateMicIndicator(active) {
  const el = document.getElementById("micIndicator");
  if (el) el.style.display = active ? "block" : "none";
  refreshWebAudioCard();
}

function refreshWebAudioCard() {
  const card = document.getElementById("webAudioCard");
  if (!card) return;
  const mic = document.getElementById("micIndicator");
  const cam = document.getElementById("camIndicator");
  const anyActive =
    (mic && mic.style.display !== "none") ||
    (cam && cam.style.display !== "none");
  card.style.display = anyActive ? "block" : "none";
}

// ── Web Audio Playback (queued) ───────────────────────────────────────────────
// When WEB_AUDIO_ENABLED=true, the server sends "play_audio" with base64 data.
// We queue incoming audio and play chunks sequentially via Web Audio API.
// This prevents overlapping playback on browsers where onended is unreliable
// (e.g. Chromium on Raspberry Pi).

let audioCtx = null;
let currentAudioSource = null;
let audioQueue = [];
let isProcessingAudio = false;
let playbackFallbackTimer = null;
let currentPlayId = null;

function ensureAudioContext() {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function sendPlayComplete(playId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const msg = { type: "play_complete" };
    if (playId !== undefined && playId !== null) msg.playId = playId;
    ws.send(JSON.stringify(msg));
  }
}

// Stop the current source WITHOUT sending play_complete (internal use).
function stopWebAudioSilent() {
  if (playbackFallbackTimer) {
    clearTimeout(playbackFallbackTimer);
    playbackFallbackTimer = null;
  }
  if (currentAudioSource) {
    // Remove onended BEFORE stop() to prevent spurious play_complete.
    currentAudioSource.onended = null;
    try { currentAudioSource.stop(); } catch {}
    currentAudioSource = null;
  }
}

function playWebAudio(base64Data, format, duration, playId) {
  audioQueue.push({ base64Data, format, duration, playId });
  if (!isProcessingAudio) {
    processAudioQueue();
  }
}

async function processAudioQueue() {
  if (isProcessingAudio) return;
  isProcessingAudio = true;
  while (audioQueue.length > 0) {
    const item = audioQueue.shift();
    await playWebAudioItem(item.base64Data, item.format, item.duration, item.playId);
  }
  isProcessingAudio = false;
}

function playWebAudioItem(base64Data, _format, duration, playId) {
  return new Promise(async (resolve) => {
    currentPlayId = playId;
    try {
      const ctx = ensureAudioContext();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const decoded = await ctx.decodeAudioData(bytes.buffer.slice(0));

      stopWebAudioSilent();
      currentAudioSource = ctx.createBufferSource();
      currentAudioSource.buffer = decoded;
      currentAudioSource.connect(ctx.destination);

      let finished = false;
      const onFinished = () => {
        if (finished) return;
        finished = true;
        if (playbackFallbackTimer) {
          clearTimeout(playbackFallbackTimer);
          playbackFallbackTimer = null;
        }
        currentAudioSource = null;
        sendPlayComplete(playId);
        resolve();
      };

      currentAudioSource.onended = onFinished;

      // Fallback timer: use decoded buffer duration (most accurate) with a margin.
      // This covers browsers where onended does not fire reliably.
      const bufferMs = decoded.duration * 1000;
      const fallbackMs = Math.max(bufferMs, duration || 0) + 2000;
      playbackFallbackTimer = setTimeout(() => {
        console.warn("[WebAudio] Fallback timer fired — onended did not fire");
        playbackFallbackTimer = null;
        if (!finished) {
          stopWebAudioSilent();
          onFinished();
        }
      }, fallbackMs);

      currentAudioSource.start(0);
    } catch (e) {
      console.error("[WebAudio] Playback failed:", e);
      sendPlayComplete(playId);
      resolve();
    }
  });
}

// Stop playback, clear queue, and notify server (used by "stop_audio" command).
function stopWebAudio() {
  audioQueue.length = 0;
  isProcessingAudio = false;
  stopWebAudioSilent();
}

// ── Web Camera Streaming ─────────────────────────────────────────────────────
// When WEB_CAMERA_ENABLED=true, the server sends "start_camera_stream" and
// "stop_camera_stream" commands. We capture from getUserMedia and stream JPEG
// frames (prefix byte 0x02). For single captures, prefix byte 0x03 is used.

let webCamStream = null;
let webCamVideo = null;
let webCamCanvas = null;
let webCamSendTimer = null;

async function startWebCameraStream() {
  if (webCamStream) return;
  try {
    webCamStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
    });
    if (!webCamVideo) {
      webCamVideo = document.createElement("video");
      webCamVideo.autoplay = true;
      webCamVideo.muted = true;
      webCamVideo.playsInline = true;
      webCamCanvas = document.createElement("canvas");
    }
    webCamVideo.srcObject = webCamStream;
    await webCamVideo.play().catch(() => {});
    updateCamIndicator(true);
    webCamSendTimer = setInterval(() => sendWebCameraFrameInternal(false), 200);
  } catch (e) {
    console.error("[WebCamera] getUserMedia (video) failed:", e);
    webCamStream = null;
  }
}

function stopWebCameraStream() {
  if (webCamSendTimer) { clearInterval(webCamSendTimer); webCamSendTimer = null; }
  if (webCamStream) { webCamStream.getTracks().forEach((t) => t.stop()); webCamStream = null; }
  updateCamIndicator(false);
}

function sendWebCameraCapture() {
  sendWebCameraFrameInternal(true);
}

function sendWebCameraFrameInternal(isCapture) {
  if (!webCamVideo || !webCamCanvas || !ws || ws.readyState !== WebSocket.OPEN) return;
  const w = webCamVideo.videoWidth || 640;
  const h = webCamVideo.videoHeight || 480;
  webCamCanvas.width = w;
  webCamCanvas.height = h;
  const ctx2d = webCamCanvas.getContext("2d");
  ctx2d.drawImage(webCamVideo, 0, 0, w, h);
  const quality = isCapture ? 0.95 : 0.75;
  webCamCanvas.toBlob(
    (blob) => {
      if (!blob || !ws || ws.readyState !== WebSocket.OPEN) return;
      blob.arrayBuffer().then((buf) => {
        const prefixByte = isCapture ? FRAME_CAM_CAPTURE : FRAME_CAM_LIVE;
        const payload = new Uint8Array(1 + buf.byteLength);
        payload[0] = prefixByte;
        payload.set(new Uint8Array(buf), 1);
        ws.send(payload);
      });
    },
    "image/jpeg",
    quality,
  );
}

function updateCamIndicator(active) {
  const el = document.getElementById("camIndicator");
  if (el) el.style.display = active ? "block" : "none";
  refreshWebAudioCard();
}

// ── Text Input ───────────────────────────────────────────────────────────────
// When the device is in "idle" (sleep) state, allow the user to type a message
// and send it directly to the LLM, bypassing ASR.

const textInput = document.getElementById("textInput");
const textSendBtn = document.getElementById("textSendBtn");
let currentDeviceStatus = "";

function updateTextInputState(status) {
  currentDeviceStatus = status || "";
  const isIdle = currentDeviceStatus === "idle" || currentDeviceStatus === "starting";
  textInput.disabled = !isIdle;
  textSendBtn.disabled = !isIdle;
}

function sendTextInput() {
  const text = (textInput.value || "").trim();
  if (!text) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "text_input", text }));
  textInput.value = "";
}

textSendBtn.addEventListener("click", sendTextInput);
textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.isComposing) {
    e.preventDefault();
    sendTextInput();
  }
});

// Unlock AudioContext on first user interaction (required by browsers).
document.addEventListener("click", () => { try { ensureAudioContext(); } catch {} }, { once: true });
document.addEventListener("touchstart", () => { try { ensureAudioContext(); } catch {} }, { once: true });

