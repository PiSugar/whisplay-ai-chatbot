import * as fs from "fs";
import * as path from "path";
import { getAudioDurationInSeconds } from "get-audio-duration";
import { spawn } from "child_process";
import dotenv from "dotenv";
import { ttsDir } from "../../utils/dir";

dotenv.config();

const piperBinaryPath = process.env.PIPER_BINARY_PATH || "/home/pi/piper/piper"; // Default to tts-1
const piperModelPath =
  process.env.PIPER_MODEL_PATH || "/home/pi/piper/voices/en_US-amy-medium.onnx";

const piperTTS = async (
  text: string
): Promise<{ data: Buffer; duration: number }> => {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    const tempWavFile = path.join(ttsDir, `piper_${now}.wav`);
    const convertedWavFile = path.join(ttsDir, `piper_${now}_converted.wav`);
    const piperProcess = spawn(piperBinaryPath, [
      "--model",
      piperModelPath,
      "--sentence-silence",
      "1",
      "--output_file",
      tempWavFile,
    ]);

    piperProcess.stdin.write(text);
    piperProcess.stdin.end();

    piperProcess.on("close", async (code: number) => {
      if (code !== 0) {
        // reject(new Error(`Piper process exited with code ${code}`));
        console.error(`Piper process exited with code ${code}`);
        resolve({ data: Buffer.from([]), duration: 0 });
        return;
      }

      if (fs.existsSync(tempWavFile) === false) {
        console.log("Piper output file not found:", tempWavFile);
        resolve({ data: Buffer.from([]), duration: 0 });
        return;
      }

      try {
        // use sox to convert wav to 24kHz, 16bit, stereo
        await new Promise<void>((res, rej) => {
            
          const soxProcess = spawn("sox", [
            "-v",
            "0.9",
            tempWavFile,
            "-r",
            "24000",
            "-c",
            "2",
            convertedWavFile,
          ]);

          soxProcess.on("close", (soxCode: number) => {
            if (soxCode !== 0) {
              console.error(`Sox process exited with code ${soxCode}`);
              rej(new Error(`Sox process exited with code ${soxCode}`));
            } else {
              // Replace original file with converted file
              fs.unlinkSync(tempWavFile);
              res();
            }
          });
        });

        const buffer = fs.readFileSync(convertedWavFile);
        const duration = (await getAudioDurationInSeconds(convertedWavFile)) * 1000;

        // Clean up temp file
        fs.unlinkSync(convertedWavFile);

        // remove wav header, otherwise playback process will stop automatically
        const headerSize = 44;
        const trimmedBuffer = buffer.subarray(headerSize);
        resolve({ data: trimmedBuffer, duration });
      } catch (error) {
        // reject(error);
        console.log("Error processing Piper output:", `"${text}"`, error);
        resolve({ data: Buffer.from([]), duration: 0 });
      }
    });

    piperProcess.on("error", (error: any) => {
      console.log("Piper process error:", `"${text}"`, error);
      resolve({ data: Buffer.from([]), duration: 0 });
    });
  });
};

export default piperTTS;
