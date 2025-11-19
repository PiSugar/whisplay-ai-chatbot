import fs from "fs";
import { spawn } from "child_process";
import { ASRServer } from "../../type";
import { asrDir } from "../../utils/dir";

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
      "txt",
      "--output_dir",
      asrDir,
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
      // Detecting language using up to the first 30 seconds. Use `--language` to specify the language\nDetected language: English\n[00:00.000 --> 00:03.000]  Hello, what's your name?
      // extract the transcription part only
      const lines = stdoutTrim.split("\n");
      let finalTranscription = "";
      for (const line of lines) {
        if (line.startsWith("[") && line.includes(" --> ")) {
          const parts = line.split("] ");
          if (parts.length > 1) {
            finalTranscription += parts[1] + " ";
          }
        }
      }
      const finalTrim = finalTranscription.trim();

      if (finalTrim) {
        // cleanup
        resolve(finalTrim);
        return;
      }

      // No stdout content; do not read/write .txt files — just resolve empty string
      resolve("");
    });
  });
};
