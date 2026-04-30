import dns from "dns";
import fs from "fs";
import { display } from "../device/display";

const CHECK_INTERVAL_MS = 10000;

const isNetworkConnected = (): Promise<boolean> => {
  return new Promise((resolve) => {
    dns.lookup("cloudflare.com", (err) => {
      resolve(!err);
    });
  });
};

/**
 * Returns wifi signal level: 0 = disconnected, 1 = weak, 2 = medium, 3 = strong.
 * Reads /proc/net/wireless on Linux; falls back to a DNS connectivity check
 * (3 if reachable, otherwise 0) on platforms where the file is unavailable.
 */
export const getWifiSignalLevel = async (): Promise<number> => {
  try {
    const content = fs.readFileSync("/proc/net/wireless", "utf8");
    const lines = content.split("\n");
    // Skip the two header lines, look for an interface with non-zero quality.
    for (let i = 2; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      // Format: iface: status quality. signal. noise. ...
      // The quality field is the 3rd column (index 2).
      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;
      const quality = parseFloat(parts[2]);
      if (Number.isNaN(quality) || quality <= 0) continue;
      // /proc/net/wireless link quality is typically 0-70.
      if (quality >= 55) return 3;
      if (quality >= 35) return 2;
      return 1;
    }
  } catch {
    // /proc/net/wireless not available (e.g. macOS dev) — fall through.
  }
  const connected = await isNetworkConnected();
  return connected ? 3 : 0;
};

export function startWifiStatus(): void {
  const updateNetworkStatus = async () => {
    const level = await getWifiSignalLevel();
    display({ wifi_signal_level: level });
  };

  void updateNetworkStatus();
  setInterval(() => {
    void updateNetworkStatus();
  }, CHECK_INTERVAL_MS);
}
