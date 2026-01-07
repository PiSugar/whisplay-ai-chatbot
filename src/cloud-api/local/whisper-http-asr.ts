import { readFileSync } from "fs";
import { ChildProcess, spawn } from "child_process";
import { ASRServer } from "../../type";
import { resolve } from "path";
import axios from "axios";
import { defaultPortMap } from "./common";

const whisperPort = process.env.WHISPER_PORT || defaultPortMap.whisper.toString();
const whisperHost = process.env.WHISPER_HOST || "localhost";
const whisperLanguage = process.env.WHISPER_LANGUAGE;
const whisperRequestType = process.env.WHISPER_REQUEST_TYPE || "filePath";

const asrServer = (process.env.ASR_SERVER || "").toLowerCase() as ASRServer;

let isWhisperInstall = false;
export const checkWhisperInstallation = (): boolean => {
  // check if whisper command is available
  try {
    spawn("whisper", ["--help"]);
  } catch (err) {
    console.error(
      "whisper command is not available. Please install Whisper and ensure whisper is in your PATH."
    );
    return false;
  }
  isWhisperInstall = true;
  return true;
};

let pyProcess: ChildProcess | null = null;
if (asrServer === ASRServer.whisperhttp) {
  checkWhisperInstallation();
  if (
    isWhisperInstall &&
    ["localhost", "0.0.0.0", "127.0.0.1"].includes(whisperHost)
  ) {
    console.log("Starting Whisper server at port", whisperPort);
    pyProcess = spawn(
      "python3",
      [
        resolve(__dirname, "../../../python/speech-service/whisper-host.py"),
        "--port",
        whisperPort,
      ],
      {
        detached: true,
        stdio: "inherit",
      }
    );
  }
}

interface WhisperResponse {
  filePath: string;
  recognition: string;
}

export const recognizeAudio = async (
  audioFilePath: string
): Promise<string> => {
  const body: { filePath?: string; base64?: string; language?: string } = {};
  body.language = whisperLanguage;
  if (whisperRequestType === "filePath") {
    body.filePath = audioFilePath;
  } else if (whisperRequestType === "base64") {
    const audioData = readFileSync(audioFilePath);
    const base64Audio = audioData.toString("base64");
    body.base64 = base64Audio;
  } else {
    console.error(
      `Invalid WHISPER_REQUEST_TYPE: ${whisperRequestType}, defaulting to filePath`
    );
    body.filePath = audioFilePath;
  }
  return axios
    .post<WhisperResponse>(
      `http://${whisperHost}:${whisperPort}/recognize`,
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
