import { spawn } from "child_process";
import { alsaInputDevice } from "./audio-device";

const envVoiceDetectLevel = process.env.VOICE_DETECT_LEVEL
  ? parseInt(process.env.VOICE_DETECT_LEVEL, 10)
  : 30;

const voiceDetectMinLevel = process.env.VOICE_DETECT_LEVEL_MIN
  ? parseInt(process.env.VOICE_DETECT_LEVEL_MIN, 10)
  : 2;

const voiceDetectMaxLevel = process.env.VOICE_DETECT_LEVEL_MAX
  ? parseInt(process.env.VOICE_DETECT_LEVEL_MAX, 10)
  : 60;

const noiseSampleDurationSec = process.env.VOICE_NOISE_SAMPLE_DURATION_SEC
  ? parseFloat(process.env.VOICE_NOISE_SAMPLE_DURATION_SEC)
  : 0.35;

const voiceDetectNoiseMargin = process.env.VOICE_DETECT_NOISE_MARGIN
  ? parseFloat(process.env.VOICE_DETECT_NOISE_MARGIN)
  : 1;

const noiseDetectIntervalMs = process.env.VOICE_NOISE_SAMPLE_INTERVAL_MS
  ? parseInt(process.env.VOICE_NOISE_SAMPLE_INTERVAL_MS, 10)
  : 30000;

const voiceDetectSmoothing = process.env.VOICE_DETECT_SMOOTHING
  ? parseFloat(process.env.VOICE_DETECT_SMOOTHING)
  : 0.7;

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

const defaultVoiceDetectLevel = Number.isFinite(envVoiceDetectLevel)
  ? clamp(Math.round(envVoiceDetectLevel), voiceDetectMinLevel, voiceDetectMaxLevel)
  : 30;

let currentVoiceDetectLevel = defaultVoiceDetectLevel;
let lastNoiseSampleAt = 0;
let hasAmbientNoiseSample = false;

const parseRmsAmplitude = (soxOutput: string): number | null => {
  const match = soxOutput.match(/RMS\s+amplitude:\s+([0-9.eE+-]+)/i);
  if (!match) {
    return null;
  }
  const rms = parseFloat(match[1]);
  if (!Number.isFinite(rms) || rms < 0) {
    return null;
  }
  return rms;
};

const detectAmbientNoiseLevel = (): Promise<number | null> => {
  return new Promise((resolve) => {
    const soxArgs = [
      "-t",
      "alsa",
      alsaInputDevice,
      "-n",
      "trim",
      "0",
      `${noiseSampleDurationSec}`,
      "stat",
    ];
    const sampleProcess = spawn("sox", soxArgs);

    let output = "";
    sampleProcess.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
    });
    sampleProcess.stderr?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    const done = () => {
      const rms = parseRmsAmplitude(output);
      if (rms === null) {
        resolve(null);
        return;
      }
      const noisePercent = clamp(Math.round(rms * 100), 0, 100);
      resolve(noisePercent);
    };

    sampleProcess.on("error", (error) => {
      console.error(
        `[Audio] Failed to sample ambient noise from ${alsaInputDevice}: ${error.message}`,
      );
      resolve(null);
    });

    sampleProcess.on("close", (code) => {
      if (code !== 0) {
        const message = output.trim().replace(/\s+/g, " ");
        console.error(
          `[Audio] Ambient noise sampling from ${alsaInputDevice} exited with code ${code}${message ? `: ${message}` : ""}`,
        );
        resolve(null);
        return;
      }
      done();
    });
  });
};

export const getDynamicVoiceDetectLevel = async (): Promise<number> => {
  const now = Date.now();
  if (now - lastNoiseSampleAt < noiseDetectIntervalMs) {
    return currentVoiceDetectLevel;
  }

  lastNoiseSampleAt = now;
  const ambientNoisePercent = await detectAmbientNoiseLevel();
  if (ambientNoisePercent === null) {
    return currentVoiceDetectLevel;
  }

  const targetLevel = clamp(
    Math.round(ambientNoisePercent + voiceDetectNoiseMargin),
    voiceDetectMinLevel,
    voiceDetectMaxLevel,
  );

  if (!hasAmbientNoiseSample) {
    currentVoiceDetectLevel = targetLevel;
    hasAmbientNoiseSample = true;
  } else {
    const smoothing = clamp(voiceDetectSmoothing, 0, 1);
    const smoothedLevel = Math.round(
      currentVoiceDetectLevel * smoothing + targetLevel * (1 - smoothing),
    );

    currentVoiceDetectLevel = clamp(
      smoothedLevel,
      voiceDetectMinLevel,
      voiceDetectMaxLevel,
    );
  }

  console.log(
    `[Audio] Ambient noise=${ambientNoisePercent}% -> voiceDetectLevel=${currentVoiceDetectLevel}%`,
  );
  return currentVoiceDetectLevel;
};
