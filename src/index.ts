import { display } from "./device/display";
import Battery from "./device/battery";
import ChatFlow from "./core/ChatFlow";

const battery = new Battery();
battery.connect().catch(e => {
  console.error("fail to connect to battery service:", e);
});
battery.addListener("batteryLevel", (data: any) => {
  display({
    battery_level: data,
  });
});

new ChatFlow();
