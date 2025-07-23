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
battery.connect().catch(e => {
  console.error("fail to connect to battery service:", e);
});
battery.addListener("batteryLevel", (data: any) => {
  console.log("battery level:", data);
  display({
    battery_level: data,
  });
});

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
  console.log("created data directory:", dataDir);
} else {
  console.log("dataDir exists:", dataDir);
}

new ChatFlow({
  dataDir,
});
