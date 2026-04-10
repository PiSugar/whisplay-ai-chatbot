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

type VpnProvider = "none" | "wireguard" | "tailscale";

const vpnProvider = (
  process.env.VPN_PROVIDER || "none"
).toLowerCase() as VpnProvider;
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
      vpn_connected: connected,
    });
  }, 10000);
};

const isTailscaleConnected = (): Promise<boolean> => {
  return new Promise((resolve) => {
    exec("tailscale status --json", (err, stdout) => {
      if (err || !stdout) {
        resolve(false);
        return;
      }

      try {
        const status = JSON.parse(stdout) as {
          BackendState?: string;
          TailscaleIPs?: string[];
          Self?: { Online?: boolean };
        };
        const hasAddress = Array.isArray(status.TailscaleIPs) && status.TailscaleIPs.length > 0;
        resolve(status.BackendState === "Running" && hasAddress && Boolean(status.Self?.Online));
      } catch {
        resolve(false);
      }
    });
  });
};

const intervalCheckTailscale = () => {
  setInterval(async () => {
    const connected = await isTailscaleConnected();
    display({
      vpn_connected: connected,
    });
  }, 10000);
};

if (vpnProvider === "wireguard") {
  intervalCheckWireguard();
} else if (vpnProvider === "tailscale") {
  intervalCheckTailscale();
} else {
  display({ vpn_connected: false });
}

new ChatFlow({
  enableCamera: process.env.ENABLE_CAMERA === "true",
});
