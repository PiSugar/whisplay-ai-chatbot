import { ttsDir } from "../utils/dir";

// list all wav files in ttsDir
import fs from "fs";
import path from "path";
import { playAudioData } from "../device/audio";
import getAudioDurationInSeconds from "get-audio-duration";

export const listWavFilesInTtsDir = (): string[] => {
  if (!fs.existsSync(ttsDir)) {
    return [];
  }
  const files = fs.readdirSync(ttsDir);
  return files
    .filter((file) => file.endsWith(".wav"))
    .map((file) => path.join(ttsDir, file));
};

const files = listWavFilesInTtsDir();

const playAllWavFiles = async () => {
  for (const filePath of files) {
    console.log("Playing:", filePath);
    const buffer = fs.readFileSync(filePath);
    const duration = (await getAudioDurationInSeconds(filePath)) * 1000;
    const headerSize = 44;
    const trimmedBuffer = buffer.subarray(headerSize);
    await playAudioData(trimmedBuffer, duration);
  }
};

setTimeout(() => {
  playAllWavFiles();
}, 6000);
