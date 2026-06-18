import * as fs from "fs";
import * as path from "path";
import { getAudioDurationInSeconds } from "get-audio-duration";
import { ChildProcess, spawn } from "child_process";
import dotenv from "dotenv";
import { ttsDir } from "../../utils/dir";
import { TTSResult, TTSServer } from "../../type";
import { defaultPortMap } from "./common";

dotenv.config();

const piperHttpHost = process.env.PIPER_HTTP_HOST || "localhost";
const piperHttpPort = process.env.PIPER_HTTP_PORT || defaultPortMap.piperHttp.toString();
const piperHttpModel =
  process.env.PIPER_HTTP_MODEL || "en_US-amy-medium";
const piperHttpLengthScale =
  process.env.PIPER_HTTP_LENGTH_SCALE || "1";

const ttsServer = (process.env.TTS_SERVER || "").toLowerCase();

let pyProcess: ChildProcess | null = null;
if (ttsServer === TTSServer.piperhttp) {
  if (
    ["localhost", "0.0.0.0", "127.0.0.1"].includes(piperHttpHost)
  ) {
    console.log("Starting Piper HTTP server at port", piperHttpPort);
    // python3 -m piper.http_server -m en_US-lessac-medium
    pyProcess = spawn(
      "python3",
      [
        "-m",
        "piper.http_server",
        "-m",
        piperHttpModel,
        "--port",
        piperHttpPort,
        "--host",
        piperHttpHost,
      ],
      {
        detached: true,
        stdio: "inherit",
      }
    );
  }
}

const piperHttpTTS = async (
  text: string
): Promise<TTSResult> => {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    const tempWavFile = path.join(ttsDir, `piper_http_${now}.wav`);
    const convertedWavFile = path.join(ttsDir, `piper_http_${now}_converted.wav`);

    // curl -X POST -H 'Content-Type: application/json' -d '{ "text": "This is a test." }' -o test.wav localhost:8805
    // text may contain double quotes, need to escape them
    const escapedText = text.replace(/"/g, '\\"');

    const piperProcess = spawn('curl', [
      "-X",
      "POST",
      "-H",
      "Content-Type: application/json",
      "-d",
      `{ "text": "${escapedText}", "length_scale": ${piperHttpLengthScale} }`,
      "-o",
      tempWavFile,
      `${piperHttpHost}:${piperHttpPort}`
    ]);

    piperProcess.stdin.write(text);
    piperProcess.stdin.end();

    piperProcess.on("close", async (code: number) => {
      if (code !== 0) {
        // reject(new Error(`Piper process exited with code ${code}`));
        console.error(`Piper process exited with code ${code}`);
        resolve({ duration: 0 });
        return;
      }

      if (fs.existsSync(tempWavFile) === false) {
        console.log("Piper output file not found:", tempWavFile);
        resolve({ duration: 0 });
        return;
      }

      try {
        // The Whisplay ES8389 ALSA device rejects Piper's 22050 Hz mono output
        // when opened directly through hw:*, so normalize to the codec format.
        await new Promise<void>((res, rej) => {
          const soxProcess = spawn("sox", [
            "-v",
            "0.9",
            tempWavFile,
            "-r",
            "48000",
            "-c",
            "2",
            "-b",
            "16",
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

        const duration = (await getAudioDurationInSeconds(convertedWavFile)) * 1000;
        // Clean up temp file
        // fs.unlinkSync(convertedWavFile);
        
        resolve({ filePath: convertedWavFile, duration });
      } catch (error) {
        // reject(error);
        console.log("Error processing Piper output:", `"${text}"`, error);
        resolve({ duration: 0 });
      }
    });

    piperProcess.on("error", (error: any) => {
      console.log("Piper process error:", `"${text}"`, error);
      resolve({ duration: 0 });
    });
  });
};

function cleanup() {
  if (pyProcess && !pyProcess.killed) {
    console.log("Killing python server...");
    process.kill(-pyProcess.pid!, "SIGTERM");
  }
}

process.on("SIGINT", cleanup); // Ctrl+C
process.on("SIGTERM", cleanup); // systemctl / docker stop
process.on("exit", cleanup);
process.on("uncaughtException", (err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});


export default piperHttpTTS;
