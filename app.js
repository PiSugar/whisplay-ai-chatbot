const fs = require("fs");
const path = require("path");
const { display, extractEmojis, onButtonPressed } = require("./device/display");
const Battery = require("./device/battery");
const {
  recordAudio,
  StreamResponser,
  stopRecording,
} = require("./device/audio");
const {
  chatWithLLMStream,
  recognizeAudio,
  ttsProcessor,
} = require("./cloud-api/server");
const { noop } = require("lodash");
const ChatFlow = require("./core/ChatFlow");

const battery = new Battery()
battery.connect()
battery.addListener("batteryLevel", (data) => {
  console.log("电量:", data);
  display({
    battery_status: data.status,
    battery_level: data.level,
  });
});

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
  console.log("创建数据文件夹:", dataDir);
} else {
  console.log("数据文件夹已存在:", dataDir);
}

(async () => {
  const dataDir = path.join(__dirname, "data");
  new ChatFlow({
    dataDir,
  })
})();
