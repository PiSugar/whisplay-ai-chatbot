const { Socket } = require("net");

const currentStatus = {
  status: "starting",
  emoji: "😊",
  text: "",
  scroll_speed: 3,
  brightness: 100,
  RGB: "#00FF30",
  battery_status: "", // "charging", "low", ""
  battery_level: 80, // 0-100
};

let buttonPressedCallback = () => {};

const client = new Socket();

const isReady = new Promise((resolve) => {
  client.connect(12345, "0.0.0.0", () => {
    console.log("Connected to local display socket");
    sendToDisplay(JSON.stringify(currentStatus));
    client.on("data", (data) => {
      console.log("Received data from local display:", data.toString());
      // {"event": "button_pressed"}
      try {
        const json = JSON.parse(data.toString());
        if (json.event === "button_pressed") {
          buttonPressedCallback();
          // 处理按钮按下事件
        }
      } catch {}
    });
    client.on("error", (err) => {
      console.error("Socket error:", err);
    });
    resolve();
  });
});

const onButtonPressed = (callback) => {
  buttonPressedCallback = callback;
};

const sendToDisplay = async (data) => {
  await isReady;
  try {
    client.write(`${data}\n`, "utf8", () => {
      // console.log("send", data);
    });
  } catch (error) {
    console.error("Failed to update display.");
  }
};

async function display(newStatus = {}) {
  const { status, emoji, text, RGB, brightness } = {
    ...currentStatus,
    ...newStatus,
  };

  const changedValues = Object.entries(newStatus).filter(
    ([key, value]) => currentStatus[key] !== value
  );

  const isTextChanged = changedValues.some(([key, value]) => key === "text");

  currentStatus.status = status;
  currentStatus.emoji = emoji;
  currentStatus.text = text;
  currentStatus.RGB = RGB;
  currentStatus.brightness = brightness;

  // 发送scoket到0.0.0.0:12345
  const changedValuesObj = Object.fromEntries(changedValues);
  changedValuesObj.brightness = 100;
  const data = JSON.stringify(changedValuesObj);
  if (isTextChanged) console.log("send data:", data);
  sendToDisplay(data);
}

function extractEmojis(str) {
  // 使用 Unicode emoji 匹配范围的正则表达式
  const array = [
    ...str.matchAll(/([\p{Emoji_Presentation}\u200d\ufe0f])/gu),
  ].map((match) => match[0]);

  if (array.length > 0) {
    return array[0];
  }
  return "😐";
}

const flashLED = (color, duration) => {
  const int = setInterval(() => {
    display({
      // blue
      RGB: color,
    });
    setTimeout(() => {
      display({
        RGB: "#000000",
      });
    }, duration / 2);
  }, duration);
  return () => {
    clearInterval(int);
  };
};

module.exports = { display, extractEmojis, onButtonPressed, flashLED };
