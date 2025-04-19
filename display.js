const { exec } = require("child_process");
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
let lastSend = Promise.resolve();
let messageCount = 0;

const waitSocketConnected = new Promise((resolve) => {
  setTimeout(() => {
    localSocket = new Socket();
    localSocket.connect(12345, "0.0.0.0", () => {
      console.log("Connected to local display socket");
      resolve();
    });
  }, 2000);
});

async function display(newStatus) {
  const oldStatus = JSON.stringify(currentStatus);
  const { status, emoji, text } = { ...currentStatus, ...newStatus };
  currentStatus.status = status;
  currentStatus.emoji = emoji;
  currentStatus.text = text;
  if (messageCount > 0 && oldStatus === JSON.stringify(currentStatus)) {
    console.log("数据未变化, 不发送");
    return;
  }
  messageCount++;
  await waitSocketConnected;
  await lastSend;
  // 发送scoket到0.0.0.0:12345
  const data = JSON.stringify(currentStatus);
  localSocket.write(data, "utf8", () => {
    console.log("发送数据到本地显示器:", data);
  });
  lastSend = new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, 3000);
  });
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
