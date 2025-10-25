import fs from "fs";
import { spawn } from "child_process";
import { ASRServer } from "../type";

const modelSize = process.env.WHISPER_MODEL_SIZE || "tiny";
const language = process.env.WHISPER_LANGUAGE || "";
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

if (asrServer === ASRServer.whisper) {
  checkWhisperInstallation();
}

export const recognizeAudio = async (
  audioFilePath: string
): Promise<string> => {
  if (!isWhisperInstall) {
    console.error("Whisper is not installed.");
    return "";
  }
  if (!modelSize) {
    console.error("WHISPER_MODEL_SIZE is not set.");
    return "";
  }
  if (!fs.existsSync(audioFilePath)) {
    console.error("Audio file does not exist:", audioFilePath);
    return "";
  }

  return await new Promise<string>((resolve) => {
    // use task=transcribe and request txt output; pass file as positional arg
    const params = [
      "--model",
      modelSize,
      "--task",
      "transcribe",
      "--output_format",
      "none",
      audioFilePath,
    ];
    if (language) {
      params.push("--language", language);
    }
    const child = spawn("whisper", params);

    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      console.error("Failed to start whisper:", err?.message ?? err);
      resolve("");
    });

    child.on("close", async (code, signal) => {
      if (stderr && stderr.trim()) {
        // CLI may output warnings to stderr
        console.error("whisper stderr:", stderr.trim());
      }
      if (code !== 0) {
        console.error(
          `whisper exited with code ${code}${signal ? ` (signal ${signal})` : ""}`
        );
      }

      const stdoutTrim = stdout ? stdout.trim() : "";
      if (stdoutTrim) {
        // cleaneup 
        resolve(stdoutTrim);
        return;
      }

      // No stdout content; do not read/write .txt files — just resolve empty string
      resolve("");
    });
  });
};
