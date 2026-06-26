const statusText = document.getElementById("statusText");
const emojiText = document.getElementById("emojiText");
const textContent = document.getElementById("textContent");
const terminalContent = document.getElementById("terminalContent");
const batteryFill = document.getElementById("batteryFill");
const batteryText = document.getElementById("batteryText");
const wifiIcon = document.getElementById("wifiIcon");
const vpnIcon = document.getElementById("vpnIcon");
const imageIcon = document.getElementById("imageIcon");
const ragIcon = document.getElementById("ragIcon");
const musicProgress = document.getElementById("musicProgress");
const musicFill = document.getElementById("musicFill");
const musicElapsed = document.getElementById("musicElapsed");
const musicTotal = document.getElementById("musicTotal");
const led = document.getElementById("led");
const ledText = document.getElementById("ledText");
const btn = document.getElementById("btn");
const btnText = document.getElementById("btnText");
const dim = document.getElementById("dim");
const imageLayer = document.getElementById("imageLayer");
const imageDisplay = document.getElementById("imageDisplay");
const approvalBar = document.getElementById("approvalBar");

let scrollTop = 0;
let scrollSpeed = 0;
let scrollTarget = null;
let scrollSyncStart = null;
let scrollSyncDuration = 0;
let scrollSyncFrom = 0;
let lastFrameTime = 0;
let maxScroll = 0;
let lastText = "";
let lastSourceText = "";
let lastTerminalText = "";
let lastImageRevision = -1;
let isPressed = false;
let activePointerId = null;

function setIconVisible(iconEl, visible) {
  iconEl.style.display = visible ? "block" : "none";
}

const WIFI_LEVEL_SRC = {
  1: "/img/wifi-weak.png",
  2: "/img/wifi-medium.png",
  3: "/img/wifi-strong.png",
};

function updateWifiIcon(level) {
  const numeric = typeof level === "number" ? level : parseInt(level, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return false;
  }
  const clamped = Math.min(3, Math.max(1, Math.round(numeric)));
  const src = WIFI_LEVEL_SRC[clamped];
  if (wifiIcon.getAttribute("src") !== src) {
    wifiIcon.setAttribute("src", src);
  }
  return true;
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
  const totalChars = getSyncTextLength(text) || 1;
  const ratio = Math.min(1, charEnd / totalChars);
  maxScroll = Math.max(0, textContent.offsetHeight - viewportHeight);
  scrollTarget = Math.max(scrollTop, Math.round(maxScroll * ratio));
  scrollSyncFrom = scrollTop;
  scrollSyncStart = performance.now();
  scrollSyncDuration = duration;
}

const TOOL_TAG_RE = /[%％﹪]\s*([A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*)(?:\s+([0-9]+s))?/gi;
const TOOL_PLACEHOLDER_RE = /\{tool:([A-Za-z0-9_-]+)\}/g;

function applyToolPlaceholders(text, placeholders) {
  const source = text || "";
  if (!placeholders || typeof placeholders !== "object") {
    return source.replace(TOOL_PLACEHOLDER_RE, "");
  }
  return source.replace(TOOL_PLACEHOLDER_RE, (_, key) => {
    const value = placeholders[key];
    return typeof value === "string" ? value : "";
  });
}

function getSyncTextLength(text) {
  return text
    .replace(TOOL_TAG_RE, "")
    .replace(/^[ \t:\-—,，.。…]+/gm, "")
    .length;
}

function isToolArgToken(token, toolName = "") {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(token)) {
    return true;
  }
  return false;
}

function consumeTailAfterMarker(value, toolName = "") {
  let tail = value.replace(/^[ \t:\-—,，.。…]+/, "");
  if (!tail) {
    return { tail: "", extraCount: 0 };
  }
  let extraCount = 0;
  let consumedCurrentArg = false;
  while (tail) {
    const parts = tail.split(/\s+/, 2);
    const first = parts[0];
    const firstLength = first.length;
    const restRaw = tail.slice(firstLength).replace(/^[\s:\-—,，.。…]+/, "");

    if (toolName && first.toLowerCase() === toolName.toLowerCase()) {
      extraCount += 1;
      tail = restRaw;
      const nextParts = tail.split(/\s+/, 2);
      if (nextParts[0] && isToolArgToken(nextParts[0], toolName)) {
        tail = tail.slice(nextParts[0].length).replace(/^[\s:\-—,，.。…]+/, "");
      }
      continue;
    }

    if (!consumedCurrentArg && isToolArgToken(first, toolName)) {
      consumedCurrentArg = true;
      tail = restRaw;
      continue;
    }

    return { tail, extraCount };
  }
  return { tail: "", extraCount };
}

function createToolTagNode(label, count, elapsed = "") {
  const tag = document.createElement("span");
  tag.className = "tool-tag";
  const name = document.createElement("span");
  name.className = "tool-tag-name";
  name.textContent = label;
  tag.appendChild(name);
  if (count > 1) {
    const countNode = document.createElement("span");
    countNode.className = "tool-tag-count";
    countNode.textContent = `x${count}`;
    tag.appendChild(countNode);
  }
  if (elapsed) {
    const elapsedNode = document.createElement("span");
    elapsedNode.className = "tool-tag-elapsed";
    elapsedNode.textContent = elapsed;
    tag.appendChild(elapsedNode);
  }
  return tag;
}

function renderToolTaggedText(container, text) {
  const fragment = document.createDocumentFragment();
  let pendingToolName = "";
  let pendingToolCount = 0;
  let pendingToolElapsed = "";

  const flushToolTag = () => {
    if (!pendingToolName || pendingToolCount <= 0) {
      return;
    }
    fragment.appendChild(createToolTagNode(pendingToolName, pendingToolCount, pendingToolElapsed));
    pendingToolName = "";
    pendingToolCount = 0;
    pendingToolElapsed = "";
  };

  const appendToolTag = (name, elapsed = "") => {
    if (pendingToolName && pendingToolName !== name) {
      flushToolTag();
    }
    pendingToolName = name;
    pendingToolCount += 1;
    if (elapsed) {
      pendingToolElapsed = elapsed;
    }
  };

  const appendText = (value) => {
    if (!value) {
      return;
    }
    fragment.appendChild(document.createTextNode(value));
  };

  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  lines.forEach((rawLine, lineIndex) => {
    TOOL_TAG_RE.lastIndex = 0;
    const matches = [...rawLine.matchAll(TOOL_TAG_RE)];
    if (lineIndex > 0) {
      flushToolTag();
      appendText("\n");
    }
    if (matches.length === 0) {
      flushToolTag();
      appendText(rawLine);
      return;
    }

    const before = rawLine.slice(0, matches[0].index);
    if (before.trim()) {
      flushToolTag();
      appendText(before);
    }

    let cursor = matches[0].index;
    matches.forEach((match) => {
      const between = rawLine.slice(cursor, match.index);
      const consumed = consumeTailAfterMarker(between, pendingToolName || "");
      for (let i = 0; i < consumed.extraCount; i += 1) {
        appendToolTag(pendingToolName);
      }
      if (consumed.tail.trim()) {
        flushToolTag();
        appendText(consumed.tail);
      }
      appendToolTag(match[1], match[2] || "");
      cursor = match.index + match[0].length;
    });

    const consumed = consumeTailAfterMarker(rawLine.slice(cursor), pendingToolName);
    for (let i = 0; i < consumed.extraCount; i += 1) {
      appendToolTag(pendingToolName);
    }
    if (consumed.tail.trim()) {
      flushToolTag();
      appendText(consumed.tail);
    }
  });
  flushToolTag();
  container.replaceChildren(fragment);
}

function updateText(text, sync, speed, toolPlaceholders) {
  const viewportHeight = document.querySelector(".text-viewport").offsetHeight;
  const sourceText = text || "";
  const nextText = applyToolPlaceholders(sourceText, toolPlaceholders);
  const sameSourceText = sourceText === lastSourceText;
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
    renderToolTaggedText(textContent, nextText);
    if (!sameSourceText && !isContinuation) {
      scrollTop = 0;
      scrollTarget = null;
      scrollSyncStart = null;
      scrollSyncDuration = 0;
      scrollSyncFrom = 0;
    }
    lastText = nextText;
    lastSourceText = sourceText;
  }

  scrollSpeed = Math.max(0, parseInt(speed || 0, 10));
  applyScrollSync(lastText, sync, viewportHeight);
  maxScroll = Math.max(0, textContent.offsetHeight - viewportHeight);
}

function updateTerminalText(text) {
  const nextText = text || "";
  const isVisible = nextText.length > 0;
  terminalContent.classList.toggle("visible", isVisible);
  textContent.classList.toggle("hidden-by-terminal", isVisible);
  if (nextText !== lastTerminalText) {
    terminalContent.textContent = nextText;
    lastTerminalText = nextText;
    const viewportHeight = document.querySelector(".text-viewport").offsetHeight;
    const terminalMaxScroll = Math.max(0, terminalContent.offsetHeight - viewportHeight);
    terminalContent.style.transform = `translateY(${-terminalMaxScroll}px)`;
  }
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

function formatMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min + ":" + (sec < 10 ? "0" : "") + sec;
}

function applyState(data) {
  if (!data || !data.ready) return;

  const status = data.status || "";
  statusText.textContent = status;
  emojiText.textContent = data.emoji || "";
  approvalBar.classList.toggle("visible", Boolean(data.approval_mode));
  updateText(data.text || "", data.scroll_sync, data.scroll_speed, data.tool_placeholders);
  updateTerminalText(data.terminal_text || "");
  updateTextInputState(data.text_input_enabled, status);

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

  setIconVisible(wifiIcon, updateWifiIcon(data.wifi_signal_level));
  setIconVisible(vpnIcon, Boolean(data.vpn_connected));
  setIconVisible(imageIcon, Boolean(data.image_icon_visible));
  setIconVisible(ragIcon, Boolean(data.rag_icon_visible));

  const progress = typeof data.music_progress === "number" ? data.music_progress : -1;
  const durationMs = typeof data.music_duration_ms === "number" ? data.music_duration_ms : 0;
  const showMusicProgress = status === "music" && progress >= 0 && durationMs > 0;
  if (showMusicProgress) {
    musicProgress.classList.add("visible");
    musicFill.style.width = (Math.min(1, Math.max(0, progress)) * 100).toFixed(1) + "%";
    musicElapsed.textContent = formatMs(durationMs * Math.min(1, Math.max(0, progress)));
    musicTotal.textContent = formatMs(durationMs);
  } else {
    musicProgress.classList.remove("visible");
    musicFill.style.width = "0%";
    musicElapsed.textContent = "0:00";
    musicTotal.textContent = "0:00";
  }

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
let currentAudioResolver = null;
let audioPlaybackGeneration = 0;

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
    try { currentAudioSource.disconnect(); } catch {}
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
    const generation = audioPlaybackGeneration;
    currentPlayId = playId;
    let finished = false;
    const finish = (notifyServer) => {
      if (finished) return;
      finished = true;
      if (currentAudioResolver === cancelPlayback) {
        currentAudioResolver = null;
      }
      if (playbackFallbackTimer) {
        clearTimeout(playbackFallbackTimer);
        playbackFallbackTimer = null;
      }
      if (currentAudioSource) {
        try { currentAudioSource.onended = null; } catch {}
        try { currentAudioSource.disconnect(); } catch {}
        currentAudioSource = null;
      }
      if (notifyServer && generation === audioPlaybackGeneration) {
        sendPlayComplete(playId);
      }
      resolve();
    };
    const cancelPlayback = () => finish(false);
    currentAudioResolver = cancelPlayback;
    try {
      const ctx = ensureAudioContext();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const decoded = await ctx.decodeAudioData(bytes.buffer.slice(0));

      if (generation !== audioPlaybackGeneration) {
        finish(false);
        return;
      }

      stopWebAudioSilent();
      currentAudioSource = ctx.createBufferSource();
      currentAudioSource.buffer = decoded;
      currentAudioSource.connect(ctx.destination);

      const onFinished = () => {
        finish(true);
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
          finish(true);
        }
      }, fallbackMs);

      currentAudioSource.start(0);
    } catch (e) {
      console.error("[WebAudio] Playback failed:", e);
      finish(true);
    }
  });
}

// Stop playback, clear queue, and notify server (used by "stop_audio" command).
function stopWebAudio() {
  audioPlaybackGeneration += 1;
  audioQueue.length = 0;
  stopWebAudioSilent();
  if (currentAudioResolver) {
    const resolveCurrentAudio = currentAudioResolver;
    currentAudioResolver = null;
    resolveCurrentAudio();
  }
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

function updateTextInputState(enabled, status) {
  currentDeviceStatus = status || "";
  const isEnabled =
    typeof enabled === "boolean"
      ? enabled
      : currentDeviceStatus === "idle" || currentDeviceStatus === "starting";
  textInput.disabled = !isEnabled;
  textSendBtn.disabled = !isEnabled;
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

updateTextInputState(false, "");

// Unlock AudioContext on first user interaction (required by browsers).
document.addEventListener("click", () => { try { ensureAudioContext(); } catch {} }, { once: true });
document.addEventListener("touchstart", () => { try { ensureAudioContext(); } catch {} }, { once: true });
