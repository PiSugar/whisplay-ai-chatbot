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
  setPressed(true);
  sendButton("press");
};
const release = () => {
  if (!isPressed) return;
  setPressed(false);
  sendButton("release");
};

btn.addEventListener("mousedown", press);
btn.addEventListener("mouseup", release);
btn.addEventListener("mouseleave", release);
window.addEventListener("mouseup", release);
btn.addEventListener("touchstart", (event) => {
  event.preventDefault();
  press();
});
btn.addEventListener("touchend", (event) => {
  event.preventDefault();
  release();
});
window.addEventListener("touchend", release);
