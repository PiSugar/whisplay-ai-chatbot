import { display } from "./device/display";
import Battery from "./device/battery";
import ChatFlow from "./core/ChatFlow";
import dotenv from "dotenv";
import { connect } from "net";
import dns from "dns";
import { exec, execFile } from "child_process";

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
  const updateNetworkStatus = async () => {
    const connected = await isNetworkConnected();
    display({
      network_connected: connected,
    });
  };

  void updateNetworkStatus();
  setInterval(() => {
    void updateNetworkStatus();
  }, 10000);
};
intervalCheckNetwork();

type VpnProvider = "auto" | "none" | "wireguard" | "tailscale";

const vpnProvider = (
  process.env.VPN_PROVIDER || "auto"
).toLowerCase() as VpnProvider;
const wireguardInterface = process.env.WIREGUARD_INTERFACE || "wg0";
const tailscaleCommand = process.env.TAILSCALE_COMMAND || "tailscale";

const isWireguardConnected = (): Promise<boolean> => {
  return new Promise((resolve) => {
    exec(`ip link show ${wireguardInterface}`, (err) => {
      resolve(!err);
    });
  });
};

const intervalCheckWireguard = () => {
  const updateWireguardStatus = async () => {
    const connected = await isWireguardConnected();
    display({
      vpn_connected: connected,
    });
  };

  void updateWireguardStatus();
  setInterval(() => {
    void updateWireguardStatus();
  }, 10000);
};

const runTailscaleCommand = (
  args: string[],
): Promise<{ ok: boolean; stdout: string }> => {
  return new Promise((resolve) => {
    execFile(tailscaleCommand, args, (err, stdout) => {
      resolve({
        ok: !err,
        stdout: typeof stdout === "string" ? stdout.trim() : "",
      });
    });
  });
};

const isTailscaleConnected = (): Promise<boolean> => {
  return new Promise(async (resolve) => {
    const statusResult = await runTailscaleCommand(["status", "--json"]);

    if (statusResult.ok && statusResult.stdout) {
      try {
        const status = JSON.parse(statusResult.stdout) as {
          BackendState?: string;
          TailscaleIPs?: string[];
          Self?: {
            Online?: boolean;
            TailscaleIPs?: string[];
          };
        };
        const topLevelAddresses = Array.isArray(status.TailscaleIPs)
          ? status.TailscaleIPs
          : [];
        const selfAddresses = Array.isArray(status.Self?.TailscaleIPs)
          ? status.Self.TailscaleIPs
          : [];
        const hasAddress = [...topLevelAddresses, ...selfAddresses].some(
          (address) => Boolean(address),
        );
        if (status.BackendState === "Running" && hasAddress) {
          resolve(true);
          return;
        }
      } catch {
        // Fall back to `tailscale ip` when JSON output is unavailable or unexpected.
      }
    }

    const ipv4Result = await runTailscaleCommand(["ip", "-4"]);
    if (ipv4Result.ok && ipv4Result.stdout) {
      resolve(true);
      return;
    }

    const ipv6Result = await runTailscaleCommand(["ip", "-6"]);
    resolve(ipv6Result.ok && Boolean(ipv6Result.stdout));
  });
};

const intervalCheckTailscale = () => {
  const updateTailscaleStatus = async () => {
    const connected = await isTailscaleConnected();
    display({
      vpn_connected: connected,
    });
  };

  void updateTailscaleStatus();
  setInterval(() => {
    void updateTailscaleStatus();
  }, 10000);
};

const intervalCheckAutoVpn = () => {
  const updateAutoVpnStatus = async () => {
    if (await isTailscaleConnected()) {
      display({
        vpn_connected: true,
      });
      return;
    }

    const connected = await isWireguardConnected();
    display({
      vpn_connected: connected,
    });
  };

  void updateAutoVpnStatus();
  setInterval(() => {
    void updateAutoVpnStatus();
  }, 10000);
};

if (vpnProvider === "wireguard") {
  intervalCheckWireguard();
} else if (vpnProvider === "tailscale") {
  intervalCheckTailscale();
} else if (vpnProvider === "none") {
  display({ vpn_connected: false });
} else {
  intervalCheckAutoVpn();
}

new ChatFlow({
  enableCamera: process.env.ENABLE_CAMERA === "true",
});
