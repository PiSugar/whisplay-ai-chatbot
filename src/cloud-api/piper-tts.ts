import { getWavFileDurationMs } from "../utils";
import dotenv from "dotenv";
const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

dotenv.config();

const openAiVoiceModel =
  process.env.PIPER_BINARY_PATH || "/home/pi/piper/piper"; // Default to tts-1
const openAiVoiceType =
  process.env.PIPER_MODEL_PATH || "/home/pi/piper/voices/en_US-amy-medium.onnx";

const dataDir = path.join(__dirname, "tts_temp");

let checkedDir = false;

const piperTTS = async (
  text: string
): Promise<{ data: Buffer; duration: number }> => {
  if (!checkedDir) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir);
      console.log("created tts directory:", dataDir);
    } else {
      console.log("ttsDir exists:", dataDir);
    }
    checkedDir = true;
  }
  return new Promise((resolve, reject) => {
    const tempWavFile = path.join(dataDir, `piper_${Date.now()}.wav`);
    const piperProcess = spawn(openAiVoiceModel, [
      "--model",
      openAiVoiceType,
      "--output_file",
      tempWavFile,
    ]);

    piperProcess.stdin.write(text);
    piperProcess.stdin.end();

    piperProcess.on("close", async (code: number) => {
      if (code !== 0) {
        reject(new Error(`Piper process exited with code ${code}`));
        return;
      }

      try {
        const buffer = await fs.readFile(tempWavFile);
        const duration = await getWavFileDurationMs(buffer);

        // Clean up temp file
        await fs.unlink(tempWavFile);

        resolve({ data: buffer, duration });
      } catch (error) {
        reject(error);
      }
    });

    piperProcess.on("error", (error: any) => {
      reject(error);
    });
  });
};

export default piperTTS;
