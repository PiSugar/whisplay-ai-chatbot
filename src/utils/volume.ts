import { execSync } from "child_process";

// amixer -c 1 get Speaker
// Capabilities: volume
// Playback channels: Front Left - Front Right
// Limits: Playback 0 - 127
// Mono:
// Front Left: Playback 121 [95%] [0.00dB]
// Front Right: Playback 121 [95%] [0.00dB]

const minDb = -120; // minimum decibel value
const maxDb = 0; // maximum decibel value
const minValue = 0; // minimum linear value
const maxValue = 127; // maximum linear value

const getAlsaVolumeDbValueFromAmixer = (): number => {
  const output = execSync("amixer -c 1 get Speaker").toString();
  const regex = /Front Left: Playback (\d+) \[(\d+)%\] \[([-\d.]+)dB\]/;
  const match = output.match(regex);
  if (match && match[3]) {
    const volume = parseFloat(match[3]);
    return volume;
  }
  return 0; // Default to min if not found
};

function dbToLogPercent(dB: number, minDb: number, maxDb: number): number {
  if (dB <= minDb) return 0;
  if (dB >= maxDb) return 100;

  const linearRatio = Math.pow(10, dB / 20);
  const linearMin = Math.pow(10, minDb / 20);
  const linearMax = Math.pow(10, maxDb / 20);

  const percent = (linearRatio - linearMin) / (linearMax - linearMin) * 100;
  return Math.round(percent * 100) / 100;
}

function logPercentToDb(percent: number, minDb: number, maxDb: number): number {
  if (percent <= 0) return minDb;
  if (percent >= 100) return maxDb;

  const linearMin = Math.pow(10, minDb / 20);
  const linearMax = Math.pow(10, maxDb / 20);
  const linearValue = linearMin + (linearMax - linearMin) * (percent / 100);
  const dB = 20 * Math.log10(linearValue);

  return Math.round(dB * 100) / 100;
}

function logPercentToAmixerValue(percent: number): number {
  const dB = logPercentToDb(percent, minDb, maxDb);
  const linearValue = Math.pow(10, dB / 20);
  const amixerValue = Math.round((linearValue / (maxValue - minValue)) * (maxValue - minValue) + minValue);
  return Math.max(minValue, Math.min(amixerValue, maxValue));
}

export function setVolumeByAmixer(logPercent: number): void {
  const amixerValue = logPercentToAmixerValue(logPercent);
  execSync(`amixer -c 1 set Speaker ${amixerValue}`);
  console.log(`Volume set to ${logPercent}% (${amixerValue} in amixer)`);
};

export function getCurrentLogPercent(): number {
  const alsaVolumeDb = getAlsaVolumeDbValueFromAmixer();
  return dbToLogPercent(alsaVolumeDb, minDb, maxDb);
}