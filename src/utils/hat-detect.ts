import { execSync } from "child_process";
import fs from "fs";

export type HatModel = "hat" | "hat-plus";

/**
 * Detect the Whisplay hat model by checking the ALSA sound cards.
 * - If an ES8388 card is found → "hat-plus"
 * - Otherwise → "hat" (wm8960)
 */
export function detectHatModel(): HatModel {
  const explicit = (process.env.WHISPLAY_HAT_MODEL || "").toLowerCase().trim();
  if (explicit === "hat" || explicit === "hat-plus") {
    return explicit as HatModel;
  }

  // Auto-detect by checking /proc/asound/cards
  try {
    const cards = fs.readFileSync("/proc/asound/cards", "utf-8");
    if (/es8388|es8389/i.test(cards)) {
      return "hat-plus";
    }
  } catch {
    // Not on Linux or /proc not available
  }

  return "hat";
}

export type SoundCardType = "wm8960" | "es8388";

/**
 * Detect the sound card type, respecting SOUND_CARD_TYPE env var.
 */
export function detectSoundCardType(): SoundCardType {
  const explicit = (process.env.SOUND_CARD_TYPE || "").toLowerCase().trim();
  if (explicit === "wm8960" || explicit === "es8388") {
    return explicit as SoundCardType;
  }

  // Auto-detect from hat model
  const model = detectHatModel();
  return model === "hat-plus" ? "es8388" : "wm8960";
}

/**
 * Get the ALSA card index from SOUND_CARD_INDEX env var with auto-detection fallback.
 */
export function getSoundCardIndex(): string {
  const explicit = process.env.SOUND_CARD_INDEX;
  if (explicit) return explicit;

  // Try to auto-detect from /proc/asound/cards
  try {
    const cards = fs.readFileSync("/proc/asound/cards", "utf-8");
    const cardType = detectSoundCardType();
    const pattern = cardType === "es8388" ? /es8388|es8389/i : /wm8960/i;
    for (const line of cards.split("\n")) {
      if (pattern.test(line)) {
        const match = line.match(/^\s*(\d+)\s/);
        if (match) return match[1];
      }
    }
  } catch {
    // Not on Linux
  }

  return "1"; // Default fallback
}
