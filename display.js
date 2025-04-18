const { exec } = require("child_process");

const currentStatus = {
  statusText: "聆听中",
  emoji: "😊",
  text: "",
};

let endProcess = () => {};

async function display(newStatus) {
  endProcess();
  const { statusText, emoji, text } = { ...currentStatus, ...newStatus };
  currentStatus.statusText = statusText;
  currentStatus.emoji = emoji;
  currentStatus.text = text;
  //  python scroll.py --status "聆听中" --emoji "🌟" --text "你好，世界！欢迎使用语音助手。"
  const command = `python3 scroll.py --status "${statusText}" --emoji "${emoji}" --text "${text}"`;
  const process = exec(command);
  endProcess = () => {
    process.kill();
  };
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
