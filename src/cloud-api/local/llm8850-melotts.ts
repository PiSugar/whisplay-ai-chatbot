import * as path from "path";
import { getAudioDurationInSeconds } from "get-audio-duration";
import dotenv from "dotenv";
import { ttsDir } from "../../utils/dir";
import axios from "axios";

dotenv.config();

const melottsUrl =
  process.env.MELO_TTS_URL || "http://localhost:8802/synthesize";

let currentRequest: Promise<boolean> | null = null;
let currentRequestResolve: ((value: boolean) => void) | null = null;

const meloTTS = async (
  sentence: string
): Promise<{ data: Buffer | string; duration: number }> => {
  if (currentRequest) {
    await currentRequest;
  }
  currentRequest = new Promise<boolean>((resolve) => {
    currentRequestResolve = resolve;
  });
  return new Promise((resolve, reject) => {
    const now = Date.now();
    const tempWavFile = path.join(ttsDir, `melotts_${now}.wav`);
    axios
      .post<{
        success: boolean;
        error?: string;
      }>(melottsUrl, {
        sentence,
        outputPath: tempWavFile,
      })
      .then(async (response) => {
        if (response.data && response.data.success) {
          resolve({
            data: tempWavFile,
            duration: (await getAudioDurationInSeconds(tempWavFile)) * 1000,
          });
        } else {
          console.error(
            "Invalid response from MeloTTS service:",
            response.data?.error || "Unknown error"
          );
          resolve({ data: Buffer.from([]), duration: 0 });
        }
      })
      .finally(() => {
        if (currentRequestResolve) {
          currentRequestResolve(true);
          currentRequest = null;
          currentRequestResolve = null;
        }
      })
      .catch((error) => {
        console.error("Error calling MeloTTS service:", error);
        resolve({ data: Buffer.from([]), duration: 0 });
      });
  });
};

export default meloTTS;
