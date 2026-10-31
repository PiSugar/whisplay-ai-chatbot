import "dotenv/config";
import { readFileSync } from "fs";

const detectWhisplaySoundCardRef = (): string | undefined => {
  try {
    const cards = readFileSync("/proc/asound/cards", "utf8");
    const line = cards
      .split("\n")
      .find((item) => /whisplaysound|wm8960soundcard|es8389soundcard/i.test(item));
    const nameMatch = line?.match(/\[([^\]]+)\]/);
    if (nameMatch?.[1]) {
      return nameMatch[1].trim();
    }
    const indexMatch = line?.match(/^\s*(\d+)\s+\[/);
    return indexMatch?.[1];
  } catch (e) {
    return undefined;
  }
};

export const soundCardRef =
  process.env.SOUND_CARD_NAME ||
  process.env.SOUND_CARD_INDEX ||
  detectWhisplaySoundCardRef();

const defaultAlsaInputDevice = soundCardRef ? `hw:${soundCardRef},0` : "default";
const defaultAlsaOutputDevice = soundCardRef === "whisplaysound"
  ? "playback"
  : soundCardRef
    ? `plughw:${soundCardRef},0`
    : "default";

export const alsaInputDevice =
  process.env.ALSA_INPUT_DEVICE || defaultAlsaInputDevice;
export const alsaOutputDevice =
  process.env.ALSA_OUTPUT_DEVICE || defaultAlsaOutputDevice;
