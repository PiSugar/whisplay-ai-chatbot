import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { getWavFileDurationMs } from "../utils";
import dotenv from "dotenv";

dotenv.config();

const piperBinaryPath =
  process.env.PIPER_BINARY_PATH || "/home/pi/piper/piper"; // Default to tts-1
const piperModelPath =
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
    const piperProcess = spawn(piperBinaryPath, [
      "--model",
      piperModelPath,
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
        const buffer = await fs.readFileSync(tempWavFile);
        const duration = await getWavFileDurationMs(buffer);

        // Clean up temp file
        await fs.unlinkSync(tempWavFile);

        // remove wav header, otherwise playback process will stop automatically
        const headerSize = 44;
        const trimmedBuffer = buffer.subarray(headerSize);
        resolve({ data: trimmedBuffer, duration });
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
