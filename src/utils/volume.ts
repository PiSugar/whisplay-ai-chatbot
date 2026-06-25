import { execSync } from "child_process";
import { readFileSync } from "fs";

const soundCardName = process.env.SOUND_CARD_NAME || "";
const detectWhisplaySoundCardRef = (): string => {
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
    return indexMatch?.[1] || "1";
  } catch {
    return "1";
  }
};
const soundCardIndex = process.env.SOUND_CARD_INDEX || detectWhisplaySoundCardRef();
const soundCardRef = soundCardName || soundCardIndex;
const isUnifiedWhisplay = soundCardName === "whisplaysound" || soundCardRef === "whisplaysound";
const speakerControl = isUnifiedWhisplay ? "speaker" : "Speaker";
console.log(`Using sound card: ${soundCardRef}`);

type VolumePoint = [number, number];

// Measured on Raspberry Pi .175 with the unified whisplaysound driver:
// setting speaker to X% through ALSA simple mixer reads back X from
// `amixer -c whisplaysound cget name=speaker`.
const unifiedDriverPercentToControlValueMap: VolumePoint[] = [
  [0, 0],
  [10, 10],
  [20, 20],
  [30, 30],
  [40, 40],
  [50, 50],
  [60, 60],
  [70, 70],
  [80, 80],
  [90, 90],
  [100, 100],
];

const legacyWm8960PercentToAmixerValueMap: VolumePoint[] = [
  [0, 0],
  [10, 67],
  [20, 85],
  [30, 96],
  [40, 103],
  [50, 109],
  [60, 114],
  [70, 118],
  [80, 121],
  [90, 124],
  [100, 127],
];

const percentToAmixerValueMap = isUnifiedWhisplay
  ? unifiedDriverPercentToControlValueMap
  : legacyWm8960PercentToAmixerValueMap;

const getVolumeValueFromAmixer = (): number => {
  const output = isUnifiedWhisplay
    ? execSync(`amixer -c ${soundCardRef} cget name='${speakerControl}'`).toString()
    : execSync(`amixer -c ${soundCardRef} get ${speakerControl}`).toString();
  if (isUnifiedWhisplay) {
    const unifiedMatch = output.match(/: values=(\d+)/);
    if (unifiedMatch && unifiedMatch[1]) {
      return parseFloat(unifiedMatch[1]);
    }
  }
  const regex = /Front Left: Playback (\d+) \[(\d+)%\] \[([-\d.]+)dB\]/;
  const match = output.match(regex);
  if (match && match[1]) {
    const volume = parseFloat(match[1]);
    return volume;
  }
  return 0; // Default to min if not found
};

function logPercentToAmixerValue(logPercent: number): number {
  if (logPercent < 0 || logPercent > 100) {
    throw new Error("logPercent must be between 0 and 100");
  }
  // 根据percentToAmixerValueMap获得amixerValue，曲线中间的值则根据线性插值
  for (let i = 0; i < percentToAmixerValueMap.length - 1; i++) {
    const [percent1, amixerValue1] = percentToAmixerValueMap[i];
    const [percent2, amixerValue2] = percentToAmixerValueMap[i + 1];
    if (logPercent >= percent1 && logPercent <= percent2) {
      // 线性插值
      return (
        amixerValue1 +
        (amixerValue2 - amixerValue1) *
          ((logPercent - percent1) / (percent2 - percent1))
      );
    }
  }
  return 0; // Default to min if not found
}

export const getCurrentLogPercent = (): number => {
  const value = getVolumeValueFromAmixer();
  // 根据当前驱动的 percentToAmixerValueMap 获得 logPercent，曲线中间的值则根据线性插值
  for (let i = 0; i < percentToAmixerValueMap.length - 1; i++) {
    const [percent1, amixerValue1] = percentToAmixerValueMap[i];
    const [percent2, amixerValue2] = percentToAmixerValueMap[i + 1];
    if (value >= amixerValue1 && value <= amixerValue2) {
      // 线性插值
      return (
        percent1 +
        (percent2 - percent1) *
          ((value - amixerValue1) / (amixerValue2 - amixerValue1))
      );
    }
  }
  return 0;
};

export const setVolumeByAmixer = (logPercent: number): void => {
  const value = Math.round(logPercentToAmixerValue(logPercent));
  const command = isUnifiedWhisplay
    ? `amixer -c ${soundCardRef} cset name='${speakerControl}' ${value}`
    : `amixer -c ${soundCardRef} set ${speakerControl} ${value}`;
  execSync(command);
};
