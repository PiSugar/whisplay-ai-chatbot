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

let localSocket = null;
let messageCount = 0;

const waitSocketConnected = new Promise((resolve) => {
  setTimeout(() => {
    localSocket = new Socket();
    localSocket.connect(12345, "0.0.0.0", () => {
      console.log("Connected to local display socket");
      resolve();
    });
    localSocket.on("error", (err) => {
      console.error("Socket error:", err);
      localSocket.destroy();
      localSocket = null;
    });
  }, 2000);
});

const throtthleSend = throttle((data) => {
  console.log("发送数据到本地显示器...", data);
  localSocket.write(data, "utf8", () => {
    console.log("已发送", data);
  });
}, 2000);

async function display(newStatus) {
  const { status, emoji, text } = { ...currentStatus, ...newStatus };
  currentStatus.status = status;
  currentStatus.emoji = emoji;
  currentStatus.text = text;
  messageCount++;
  await waitSocketConnected;
  // 发送scoket到0.0.0.0:12345
  const data = JSON.stringify(currentStatus);
  throtthleSend(data);
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
