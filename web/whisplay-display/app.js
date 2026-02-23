const statusText = document.getElementById("statusText");
const emojiText = document.getElementById("emojiText");
const textContent = document.getElementById("textContent");
const batteryFill = document.getElementById("batteryFill");
const batteryText = document.getElementById("batteryText");
const netIcon = document.getElementById("netIcon");
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
let scrollStep = 0;
let lastText = "";
let lastImageRevision = -1;
let isPressed = false;

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
  const maxScroll = Math.max(0, textContent.offsetHeight - viewportHeight);
  scrollTarget = Math.round(maxScroll * ratio);
  const frames = Math.max(1, Math.floor(duration / 200));
  scrollStep = (scrollTarget - scrollTop) / frames;
}

function updateText(text, sync, speed) {
  const viewportHeight = document.querySelector(".text-viewport").offsetHeight;
  if (text !== lastText) {
    textContent.textContent = text || "";
    scrollTop = 0;
    scrollTarget = null;
    scrollStep = 0;
    lastText = text;
  }

  scrollSpeed = Math.max(0, parseInt(speed || 0, 10));
  applyScrollSync(text, sync, viewportHeight);

  const maxScroll = Math.max(0, textContent.offsetHeight - viewportHeight);
  if (scrollTarget !== null) {
    const remaining = scrollTarget - scrollTop;
    if (Math.abs(remaining) <= Math.abs(scrollStep)) {
      scrollTop = scrollTarget;
      scrollTarget = null;
      scrollStep = 0;
    } else {
      scrollTop += scrollStep;
    }
  } else if (scrollSpeed > 0 && scrollTop < maxScroll) {
    scrollTop = Math.min(maxScroll, scrollTop + scrollSpeed);
  }

  textContent.style.transform = `translateY(${-scrollTop}px)`;
}

async function fetchState() {
  const res = await fetch("/state");
  if (!res.ok) return;
  const data = await res.json();
  if (!data.ready) return;

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

  netIcon.style.opacity = data.network_connected ? "1" : "0.3";
  ragIcon.style.opacity = data.rag_icon_visible ? "1" : "0.3";

  const dimOpacity = Math.max(0, Math.min(1, (100 - (data.brightness ?? 100)) / 100));
  dim.style.opacity = dimOpacity.toFixed(2);

  if (data.image && data.image_revision !== lastImageRevision) {
    lastImageRevision = data.image_revision;
    imageDisplay.src = `/image?rev=${lastImageRevision}`;
    imageLayer.style.display = "flex";
  } else if (!data.image) {
    imageLayer.style.display = "none";
  }
}

async function tick() {
  await fetchState();
}

setInterval(tick, 200);
tick();

async function sendButton(action) {
  await fetch("/button", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

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
