import { display } from "./device/display";
import Battery from "./device/battery";
import ChatFlow from "./core/ChatFlow";
import dotenv from "dotenv";
import { connect } from "net";
import dns from "dns";
import { exec } from "child_process";

dotenv.config();

const battery = new Battery();
battery.connect().catch((e) => {
  console.log("Failed to reconnect to battery service.");
});
battery.addListener("batteryLevel", (data: number) => {
  let color = "#34d351";
  if (data <= 30) {
    color = "#ff7700";
  }
  if (data <= 10) {
    color = "#ff0000";
  }
  display({
    battery_level: data,
    battery_color: color,
  });
});

const isNetworkConnected: () => Promise<boolean> = () => {
  return new Promise((resolve) => {
    dns.lookup("cloudflare.com", (err) => {
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
};

const intervalCheckNetwork = () => {
  setInterval(async () => {
    const connected = await isNetworkConnected();
    display({
      network_connected: connected,
    });
  }, 10000);
};
intervalCheckNetwork();

const wireguardInterface = process.env.WIREGUARD_INTERFACE || "wg0";

const isWireguardConnected = (): Promise<boolean> => {
  return new Promise((resolve) => {
    exec(`ip link show ${wireguardInterface}`, (err) => {
      resolve(!err);
    });
  });
};

const intervalCheckWireguard = () => {
  setInterval(async () => {
    const connected = await isWireguardConnected();
    display({
      wireguard_connected: connected,
    });
  }, 10000);
};
intervalCheckWireguard();

new ChatFlow({
  enableCamera: process.env.ENABLE_CAMERA === "true",
});
