import fs from "fs";
import { spawn } from "child_process";
import { ASRServer } from "../../type";

const modelPath = process.env.VOSK_MODEL_PATH || "";
const asrServer = (process.env.ASR_SERVER || "").toLowerCase() as ASRServer;

let isVoskInstall = false;
export const checkVoskInstallation = (): boolean => {
  // check if vosk-transcriber command is available
  try {
    spawn("vosk-transcriber", ["--help"]);
  } catch (err) {
    console.error(
      "vosk-transcriber command is not available. Please install Vosk and ensure vosk-transcriber is in your PATH."
    );
    return false;
  }
  isVoskInstall = true;
  return true;
};

if (asrServer === ASRServer.vosk) {
  checkVoskInstallation();
}

export const recognizeAudio = async (
  audioFilePath: string
): Promise<string> => {
  if (!isVoskInstall) {
    console.error("Vosk is not installed.");
    return "";
  }
  if (!modelPath) {
    console.error("VOSK_MODEL_PATH is not set.");
    return "";
  }
  if (!fs.existsSync(audioFilePath)) {
    console.error("Audio file does not exist:", audioFilePath);
    return "";
  }

  const cmd = "vosk-transcriber";

  return await new Promise<string>((resolve) => {
    const child = spawn(cmd, ["--model", modelPath, "--input", audioFilePath]);

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
      console.error("Failed to start vosk-transcriber:", err?.message ?? err);
      resolve("");
    });

    child.on("close", (code, signal) => {
      if (stderr && stderr.trim()) {
        // 有些 CLI 会把警告输出到 stderr，但仍然返回有效的 stdout
        console.error("vosk-transcriber stderr:", stderr.trim());
      }
      if (code !== 0) {
        console.error(
          `vosk-transcriber exited with code ${code}${
            signal ? ` (signal ${signal})` : ""
          }`
        );
      }
      resolve(stdout ? stdout.trim() : "");
    });
  });
};
