import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import { spawn } from "child_process";
import { resolve } from "path";
import { ASRServer } from "../../type";
import { defaultPortMap } from "./common";

dotenv.config();

const hailoWhisperPort =
  process.env.HAILO_WHISPER_PORT || String(defaultPortMap.hailoWhisper);
const hailoWhisperHost =
  process.env.HAILO_WHISPER_HOST || "localhost";
const hailoWhisperLanguage =
  process.env.HAILO_WHISPER_LANGUAGE || "en";
const hailoWhisperRequestType =
  process.env.HAILO_WHISPER_REQUEST_TYPE || "base64";

let pyProcess: ReturnType<typeof spawn> | null = null;

interface HailoWhisperResponse {
  recognition: string;
  language?: string;
  time_cost?: number;
}

export const recognizeAudio = async (
  audioFilePath: string
): Promise<string> => {
  const body: { filePath?: string; base64?: string; language?: string } = {};
  body.language = hailoWhisperLanguage;

  if (hailoWhisperRequestType === "filePath") {
    body.filePath = audioFilePath;
  } else {
    // Default: send as base64 (works for both local and remote hosts)
    const audioData = fs.readFileSync(audioFilePath);
    body.base64 = audioData.toString("base64");
  }

  return axios
    .post<HailoWhisperResponse>(
      `http://${hailoWhisperHost}:${hailoWhisperPort}/recognize`,
      body,
      { timeout: 20000 }
    )
    .then((response) => {
      if (response.data?.recognition) {
        return response.data.recognition;
      }
      console.error("Invalid response from Hailo Whisper service:", response.data);
      return "";
    })
    .catch((error) => {
      console.error("Error calling Hailo Whisper service:", error.message);
      return "";
    });
};

// ── Cleanup ──────────────────────────────────────────────────────────────────

function cleanup() {
  if (pyProcess && !pyProcess.killed && pyProcess.pid) {
    console.log("Stopping Hailo Whisper service …");
    try {
      process.kill(-pyProcess.pid, "SIGTERM");
    } catch {
      // ignore
    }
  }
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
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
