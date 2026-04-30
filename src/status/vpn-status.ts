import { exec, execFile } from "child_process";
import { display } from "../device/display";

const CHECK_INTERVAL_MS = 10000;

type VpnProvider = "auto" | "none" | "wireguard" | "tailscale";

const wireguardInterface = process.env.WIREGUARD_INTERFACE || "wg0";
const tailscaleCommand = process.env.TAILSCALE_COMMAND || "tailscale";

const isWireguardConnected = (): Promise<boolean> => {
  return new Promise((resolve) => {
    exec(`ip link show ${wireguardInterface}`, (err) => {
      resolve(!err);
    });
  });
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

const isTailscaleConnected = async (): Promise<boolean> => {
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
        return true;
      }
    } catch {
      // Fall back to `tailscale ip` when JSON output is unavailable or unexpected.
    }
  }

  const ipv4Result = await runTailscaleCommand(["ip", "-4"]);
  if (ipv4Result.ok && ipv4Result.stdout) {
    return true;
  }

  const ipv6Result = await runTailscaleCommand(["ip", "-6"]);
  return ipv6Result.ok && Boolean(ipv6Result.stdout);
};

const intervalCheckWireguard = () => {
  const updateWireguardStatus = async () => {
    const connected = await isWireguardConnected();
    display({ vpn_connected: connected });
  };

  void updateWireguardStatus();
  setInterval(() => {
    void updateWireguardStatus();
  }, CHECK_INTERVAL_MS);
};

const intervalCheckTailscale = () => {
  const updateTailscaleStatus = async () => {
    const connected = await isTailscaleConnected();
    display({ vpn_connected: connected });
  };

  void updateTailscaleStatus();
  setInterval(() => {
    void updateTailscaleStatus();
  }, CHECK_INTERVAL_MS);
};

const intervalCheckAutoVpn = () => {
  const updateAutoVpnStatus = async () => {
    if (await isTailscaleConnected()) {
      display({ vpn_connected: true });
      return;
    }
    const connected = await isWireguardConnected();
    display({ vpn_connected: connected });
  };

  void updateAutoVpnStatus();
  setInterval(() => {
    void updateAutoVpnStatus();
  }, CHECK_INTERVAL_MS);
};

export function startVpnStatus(): void {
  const vpnProvider = (
    process.env.VPN_PROVIDER || "auto"
  ).toLowerCase() as VpnProvider;

  if (vpnProvider === "wireguard") {
    intervalCheckWireguard();
  } else if (vpnProvider === "tailscale") {
    intervalCheckTailscale();
  } else if (vpnProvider === "none") {
    display({ vpn_connected: false });
  } else {
    intervalCheckAutoVpn();
  }
}
