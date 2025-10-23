import { execSync } from "child_process";

// amixer -c 1 get Speaker
// Capabilities: volume
// Playback channels: Front Left - Front Right
// Limits: Playback 0 - 127
// Mono:
// Front Left: Playback 121 [95%] [0.00dB]
// Front Right: Playback 121 [95%] [0.00dB]

const soundCardIndex = process.env.SOUND_CARD_INDEX || "1";
console.log(`Using sound card index: ${soundCardIndex}`);

// curve
const percentToAmixerValueMap = [
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

const getVolumeValueFromAmixer = (): number => {
  const output = execSync(`amixer -c ${soundCardIndex} get Speaker`).toString();
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
  // 根据percentToAmixerValueMap获得logPercent，曲线中间的值则根据线性插值
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
  const value = logPercentToAmixerValue(logPercent);
  execSync(`amixer -c ${soundCardIndex} set Speaker ${value}`);
};
