import fs from "fs";

export type HatModel = "hat" | "hat-plus";

/**
 * Detect the Whisplay model without relying on ALSA card names. Both HAT
 * variants use the unified `whisplaysound` driver; Hat Plus is identified by
 * its connected DSI display or an explicit environment override.
 */
export function detectHatModel(): HatModel {
  const explicit = (process.env.WHISPLAY_HAT_MODEL || "").toLowerCase().trim();
  if (explicit === "hat" || explicit === "hat-plus") {
    return explicit as HatModel;
  }

  // Auto-detect a connected DSI display.
  try {
    for (const entry of fs.readdirSync("/sys/class/drm")) {
      if (!/dsi/i.test(entry)) continue;
      const statusPath = `/sys/class/drm/${entry}/status`;
      if (!fs.existsSync(statusPath)) continue;
      if (fs.readFileSync(statusPath, "utf-8").trim().toLowerCase() === "connected") {
        return "hat-plus";
      }
    }
  } catch {
    // Not on Linux or DRM connector state is unavailable.
  }

  return "hat";
}
