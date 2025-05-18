const fs = require("fs");
const path = require("path");
const { display } = require("./device/display");
const Battery = require("./device/battery");
const ChatFlow = require("./core/ChatFlow");

const battery = new Battery()
battery.connect()
battery.addListener("batteryLevel", (data) => {
  console.log("电量:", data);
  display({
    battery_level: data,
  });
});

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
  console.log("创建数据文件夹:", dataDir);
} else {
  console.log("数据文件夹已存在:", dataDir);
}

new ChatFlow({
  dataDir,
})
