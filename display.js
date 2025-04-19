const { exec } = require("child_process");
const { throttle } = require("lodash");
const { Socket } = require("net");

// {
//   "status": random.choice(status_options),
//   "emoji": random.choice(emoji_options),
//   "text": f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} - {random_text}",
//   "scroll_speed": random.choice(scroll_speed_options)
// }

const currentStatus = {
  status: "聆听中",
  emoji: "😊",
  text: "",
  scroll_speed: 3,
};

const sendToDisplay = (data) => {
  const client = new Socket();
  client.connect(12345, "0.0.0.0", () => {
    console.log("Connected to local display socket");
    client.write(`${data}\n`, "utf8", () => {
      console.log("已发送", data);
      client.destroy();
    });
    client.on("data", (data) => {
      console.log("Received data from local display:", data.toString());
      // 处理接收到的数据
    });
    client.on("error", (err) => {
      console.error("Socket error:", err);
      client.destroy();
    });
  });
};

async function display(newStatus) {
  const { status, emoji, text } = { ...currentStatus, ...newStatus };
  currentStatus.status = status;
  currentStatus.emoji = emoji;
  currentStatus.text = text;

  // 发送scoket到0.0.0.0:12345
  const data = JSON.stringify(currentStatus);
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

module.exports = { display, extractEmojis };
