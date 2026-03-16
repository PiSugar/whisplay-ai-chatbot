// ── DOM references ──────────────────────────────────────────────────────────
const statusText = document.getElementById("statusText");
const emojiText = document.getElementById("emojiText");
const textContent = document.getElementById("textContent");
const batteryFill = document.getElementById("batteryFill");
const batteryText = document.getElementById("batteryText");
const netIcon = document.getElementById("netIcon");
const imageIcon = document.getElementById("imageIcon");
const ragIcon = document.getElementById("ragIcon");
const ledDot = document.getElementById("ledDot");
const recordBtn = document.getElementById("recordBtn");
const dim = document.getElementById("dim");
const imageLayer = document.getElementById("imageLayer");
const imageDisplay = document.getElementById("imageDisplay");
const menuBtn = document.getElementById("menuBtn");
const menuOverlay = document.getElementById("menuOverlay");
const menuClose = document.getElementById("menuClose");
const volumeSlider = document.getElementById("volumeSlider");
const volumeValue = document.getElementById("volumeValue");

// ── Scroll state ────────────────────────────────────────────────────────────
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

// ── Helpers ─────────────────────────────────────────────────────────────────
function setIconVisible(el, visible) {
  el.style.display = visible ? "block" : "none";
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

function emojiToSvgUrl(emoji) {
  const codepoints = [...emoji]
    .map((c) => c.codePointAt(0).toString(16))
    .join("-");
  return `/emoji-svg/${codepoints}.svg`;
}

let lastEmoji = "";

function updateEmoji(emoji) {
  if (emoji === lastEmoji) return;
  lastEmoji = emoji;
  if (!emoji) {
    emojiText.textContent = "...";
    return;
  }
  const img = document.createElement("img");
  img.src = emojiToSvgUrl(emoji);
  img.alt = emoji;
  img.onerror = function () {
    // Try without variant selectors (fe0f)
    const stripped = emoji.replace(/\uFE0F/g, "");
    if (stripped !== emoji) {
      const img2 = document.createElement("img");
      img2.src = emojiToSvgUrl(stripped);
      img2.alt = emoji;
      img2.onerror = function () {
        emojiText.textContent = emoji;
      };
      emojiText.innerHTML = "";
      emojiText.appendChild(img2);
    } else {
      emojiText.textContent = emoji;
    }
  };
  emojiText.innerHTML = "";
  emojiText.appendChild(img);
}

// ── Scroll sync ─────────────────────────────────────────────────────────────
function applyScrollSync(text, sync, viewportHeight) {
  if (!sync || !text) return;
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
  const viewport = document.querySelector(".text-viewport");
  if (!viewport) return;
  const viewportHeight = viewport.offsetHeight;
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
  if (!lastFrameTime) lastFrameTime = timestamp;
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

// ── WebSocket ───────────────────────────────────────────────────────────────
let ws = null;
let reconnectTimer = null;
let cameraTimer = null;
let volumeFetchPending = false;

function applyState(data) {
  if (!data || !data.ready) return;

  statusText.textContent = data.status || "";
  updateEmoji(data.emoji || "");
  updateText(data.text || "", data.scroll_sync, data.scroll_speed);

  // LED dot
  const ledColor = normalizeColor(data.RGB);
  ledDot.style.background = ledColor;
  ledDot.style.boxShadow = `0 0 8px ${ledColor}`;

  // Battery
  const batteryLevel = typeof data.battery_level === "number" ? data.battery_level : null;
  if (batteryLevel === null) {
    batteryText.textContent = "--%";
    batteryFill.style.width = "0%";
  } else {
    batteryText.textContent = `${batteryLevel}%`;
    batteryFill.style.width = `${Math.min(100, Math.max(0, batteryLevel))}%`;
  }
  batteryFill.style.background = normalizeColor(data.battery_color);

  // Icons
  setIconVisible(netIcon, Boolean(data.network_connected));
  setIconVisible(imageIcon, Boolean(data.image_icon_visible));
  setIconVisible(ragIcon, Boolean(data.rag_icon_visible));

  // Brightness dim
  const dimOpacity = Math.max(0, Math.min(1, (100 - (data.brightness ?? 100)) / 100));
  dim.style.opacity = dimOpacity.toFixed(2);

  // Camera mode
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

  ws.addEventListener("open", () => {
    // Request current volume when connected
    sendJson({ type: "get_volume" });
  });

  ws.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "state") {
      applyState(message.payload);
    } else if (message.type === "volume") {
      // Volume response from server
      const pct = Math.round(message.percent || 0);
      volumeSlider.value = pct;
      volumeValue.textContent = `${pct}%`;
    } else if (message.type === "start_record") {
      startWebAudioRecording();
    } else if (message.type === "stop_record") {
      stopWebAudioRecording();
    } else if (message.type === "play_audio") {
      playWebAudio(message.data, message.format, message.duration);
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

function sendJson(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function sendButton(action) {
  sendJson({ type: "button", action });
}

// ── Button press-and-hold ───────────────────────────────────────────────────
function setPressed(value) {
  isPressed = value;
  recordBtn.classList.toggle("pressed", value);
}

const press = () => {
  setPressed(true);
  sendButton("press");
};

const release = () => {
  if (!isPressed) return;
  setPressed(false);
  sendButton("release");
};

recordBtn.addEventListener("mousedown", (e) => { e.preventDefault(); press(); });
recordBtn.addEventListener("mouseup", release);
recordBtn.addEventListener("mouseleave", release);
window.addEventListener("mouseup", release);
recordBtn.addEventListener("touchstart", (e) => { e.preventDefault(); press(); });
recordBtn.addEventListener("touchend", (e) => { e.preventDefault(); release(); });
window.addEventListener("touchend", release);

// ── Menu ────────────────────────────────────────────────────────────────────
menuBtn.addEventListener("click", () => {
  menuOverlay.classList.add("open");
  // Fetch fresh volume
  sendJson({ type: "get_volume" });
});

menuClose.addEventListener("click", () => {
  menuOverlay.classList.remove("open");
});

menuOverlay.addEventListener("click", (e) => {
  if (e.target === menuOverlay) {
    menuOverlay.classList.remove("open");
  }
});

// Volume slider
let volumeDebounce = null;
volumeSlider.addEventListener("input", () => {
  const pct = parseInt(volumeSlider.value, 10);
  volumeValue.textContent = `${pct}%`;
  clearTimeout(volumeDebounce);
  volumeDebounce = setTimeout(() => {
    sendJson({ type: "set_volume", percent: pct });
  }, 100);
});

// ── Start ───────────────────────────────────────────────────────────────────
connectWebSocket();
requestAnimationFrame(animateScroll);

// ── Web Audio Recording ─────────────────────────────────────────────────────
const FRAME_AUDIO = 0x01;
const FRAME_CAM_LIVE = 0x02;
const FRAME_CAM_CAPTURE = 0x03;

let mediaRecorder = null;
let audioStream = null;

async function startWebAudioRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") return;
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      event.data.arrayBuffer().then((buf) => {
        const payload = new Uint8Array(1 + buf.byteLength);
        payload[0] = FRAME_AUDIO;
        payload.set(new Uint8Array(buf), 1);
        ws.send(payload);
      });
    };

    mediaRecorder.onstop = () => {
      if (audioStream) {
        audioStream.getTracks().forEach((t) => t.stop());
        audioStream = null;
      }
      mediaRecorder = null;
      sendJson({ type: "record_complete" });
    };

    mediaRecorder.start(500);
  } catch (e) {
    console.error("[WebAudio] getUserMedia failed:", e);
    sendJson({ type: "record_complete" });
  }
}

function stopWebAudioRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}

// ── Web Audio Playback ──────────────────────────────────────────────────────
let audioCtx = null;
let currentAudioSource = null;

function ensureAudioContext() {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

async function playWebAudio(base64Data, _format, _duration) {
  try {
    const ctx = ensureAudioContext();
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const decoded = await ctx.decodeAudioData(bytes.buffer);
    stopWebAudio();
    currentAudioSource = ctx.createBufferSource();
    currentAudioSource.buffer = decoded;
    currentAudioSource.connect(ctx.destination);
    currentAudioSource.onended = () => {
      currentAudioSource = null;
      sendJson({ type: "play_complete" });
    };
    currentAudioSource.start(0);
  } catch (e) {
    console.error("[WebAudio] Playback failed:", e);
    sendJson({ type: "play_complete" });
  }
}

function stopWebAudio() {
  if (currentAudioSource) {
    try { currentAudioSource.stop(); } catch {}
    currentAudioSource = null;
  }
}

// ── Web Camera ──────────────────────────────────────────────────────────────
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
    webCamSendTimer = setInterval(() => sendWebCameraFrameInternal(false), 200);
  } catch (e) {
    console.error("[WebCamera] getUserMedia (video) failed:", e);
    webCamStream = null;
  }
}

function stopWebCameraStream() {
  if (webCamSendTimer) { clearInterval(webCamSendTimer); webCamSendTimer = null; }
  if (webCamStream) { webCamStream.getTracks().forEach((t) => t.stop()); webCamStream = null; }
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
