import { ttsDir } from "../utils/dir";

// list all wav files in ttsDir
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const soundCardIndex = process.env.SOUND_CARD_INDEX || "1";

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
    // const buffer = fs.readFileSync(filePath);
    // const duration = (await getAudioDurationInSeconds(filePath)) * 1000;
    // const headerSize = 44;
    // const trimmedBuffer = buffer.subarray(headerSize);
    await new Promise<void>(async (resolve, reject) => {
      const process = spawn("aplay", [
        filePath,
        "-D",
        `hw:${soundCardIndex},0`,
      ]);
      process.on("close", (code: number) => {
        if (code !== 0) {
          console.error(`Playback process exited with code ${code}`);
          reject(new Error(`Playback process exited with code ${code}`));
        } else {
          console.log(`Finished playing ${filePath}`);
          resolve();
        }
      });
    }).catch((error) => {
      console.error("Error during playback:", error);
    });
  }
};

playAllWavFiles();
