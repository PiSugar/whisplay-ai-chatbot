// const fs = require("fs");
// const path = require("path");
// const { display } = require("./device/display");
// const Battery = require("./device/battery");
// const ChatFlow = require("./core/ChatFlow");

import * as fs from "fs";
import * as path from "path";
import { display } from "./device/display";
import Battery from "./device/battery";
import ChatFlow from "./core/ChatFlow";

const battery = new Battery();
battery.connect();
battery.addListener("batteryLevel", (data: any) => {
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
});
