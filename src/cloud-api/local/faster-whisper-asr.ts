import axios from "axios";
import dotenv from "dotenv";
import { resolve } from "path";
import { ASRServer } from "../../type";
import { spawn } from "child_process";
import { readFileSync } from "fs";
// import fs from "fs";

dotenv.config();

const fasterWhisperPort = process.env.FASTER_WHISPER_PORT || "8803";
const fasterWhisperHost = process.env.FASTER_WHISPER_HOST || "localhost";
const fasterWhisperRequestType =
  process.env.FASTER_WHISPER_REQUEST_TYPE || "filePath";

let pyProcess: any = null;
const asrServer = process.env.ASR_SERVER || "";

if (asrServer.trim().toLowerCase() === ASRServer.fasterwhisper) {
  pyProcess = spawn(
    "python3",
    [resolve(__dirname, "../../python/faster-whisper.py")],
    {
      detached: true,
      stdio: "inherit",
    }
  );
}

interface FasterWhisperResponse {
  filePath: string;
  recognition: string;
}

export const recognizeAudio = async (
  audioFilePath: string
): Promise<string> => {

  const body: any = {};
  if (fasterWhisperRequestType === "filePath") {
    body.filePath = audioFilePath;
  } else if (fasterWhisperRequestType === "base64") {
    const audioData = readFileSync(audioFilePath);
    const base64Audio = audioData.toString("base64");
    body.base64 = base64Audio;
  } else {
    console.error(
      `Invalid FASTER_WHISPER_REQUEST_TYPE: ${fasterWhisperRequestType}, defaulting to filePath`
    );
    body.filePath = audioFilePath;
  }

  return axios
    .post<FasterWhisperResponse>(
      `http://${fasterWhisperHost}:${fasterWhisperPort}/recognize`,
      body
    )
    .then((response) => {
      if (response.data && response.data.recognition) {
        return response.data.recognition;
      } else {
        console.error("Invalid response from Whisper service:", response.data);
        return "";
      }
    })
    .catch((error) => {
      console.error("Error calling Whisper service:", error);
      return "";
    });
};

function cleanup() {
  if (pyProcess && !pyProcess.killed) {
    console.log("Killing python server...");
    process.kill(-pyProcess.pid, "SIGTERM");
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
