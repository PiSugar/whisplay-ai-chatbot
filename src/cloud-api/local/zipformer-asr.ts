import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { getVoiceDetectEndSilenceSeconds } from "../../config/auto-listening";
import type { ASRProvider, ASRRecordingStream, PluginContext } from "../../plugin/types";

type RecognitionRequest = { type: "start"; endpoint?: true } | { type: "file"; path: string };

function connectZipformer(
  path: string,
  request: RecognitionRequest,
  timeoutMs: number,
  onPartial?: (text: string) => void,
  onEndpoint?: () => void,
): ASRRecordingStream {
  const id = randomUUID();
  const socket = createConnection(path);
  const lines = createInterface({ input: socket });
  let resolveResult: (text: string | undefined) => void = () => {};
  const result = new Promise<string | undefined>((resolve) => { resolveResult = resolve; });
  let settled = false;
  let finishing = request.type === "file";
  let timer: NodeJS.Timeout | undefined;

  const send = (type: string, data: Record<string, string> = {}) =>
    socket.write(JSON.stringify({ id, type, ...data }) + "\n");

  const settle = (text?: string) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    lines.close();
    socket.destroy();
    resolveResult(text);
  };

  socket.on("error", () => settle());
  socket.on("close", () => settle());
  lines.on("error", () => settle());
  lines.on("line", (line) => {
    if (settled) return;
    try {
      const message = JSON.parse(line);
      if (message.id !== id) return;
      if (message.type === "error") settle();
      if (message.type === "partial" && !finishing && typeof message.text === "string") {
        onPartial?.(message.text);
      }
      if (message.type === "endpoint" && !finishing) onEndpoint?.();
      if (message.type === "final" && finishing && typeof message.text === "string") {
        settle(message.text);
      }
    } catch {
      settle();
    }
  });

  const cancel = () => {
    if (settled) return;
    send("cancel");
    socket.end();
    settled = true;
    clearTimeout(timer);
    lines.close();
    resolveResult(undefined);
    socket.setTimeout(1000, () => socket.destroy());
  };

  socket.write(JSON.stringify({ id, ...request }) + "\n");
  if (finishing) timer = setTimeout(cancel, timeoutMs);
  return {
    write(audio) {
      if (settled || finishing) return;
      // Limit buffered writes if the server stops reading. The WAV remains available.
      if (socket.writableLength > 128 * 1024) {
        settle();
        return;
      }
      for (let offset = 0; offset < audio.length; offset += 8192) {
        send("audio", { pcm: audio.subarray(offset, offset + 8192).toString("base64") });
      }
    },
    finish(remainingMs = timeoutMs) {
      if (!settled && !finishing) {
        if (remainingMs <= 0) {
          cancel();
          return result;
        }
        finishing = true;
        timer = setTimeout(cancel, remainingMs);
        send("finish");
      }
      return result;
    },
    cancel,
  };
}

export function openZipformerStream(
  path: string,
  onPartial: (text: string) => void,
  timeoutMs = 3000,
  onEndpoint?: () => void,
): ASRRecordingStream {
  const request: RecognitionRequest = onEndpoint ? { type: "start", endpoint: true } : { type: "start" };
  return connectZipformer(path, request, timeoutMs, onPartial, onEndpoint);
}

export function recognizeZipformerFile(
  socketPath: string,
  audioPath: string,
  timeoutMs = 30_000,
): Promise<string | undefined> {
  return connectZipformer(socketPath, { type: "file", path: audioPath }, timeoutMs).finish();
}

export function createZipformerProvider(env: PluginContext["env"]): ASRProvider {
  const directory = env.ZIPFORMER_MODEL_DIR?.trim();
  if (!directory) throw new Error("[Zipformer] Set ZIPFORMER_MODEL_DIR to a local streaming model directory.");
  const python = env.ZIPFORMER_PYTHON_PATH?.trim() || "python3";
  const threads = Number(env.ZIPFORMER_THREADS || "2");
  if (!Number.isSafeInteger(threads) || threads < 1) {
    throw new Error("[Zipformer] ZIPFORMER_THREADS must be a positive integer.");
  }

  const socketDirectory = mkdtempSync("/tmp/whisplay-zipformer-");
  const socketPath = join(socketDirectory, "asr.sock");
  const child = spawn(python, [
    resolve(__dirname, "../../../python/speech-service/zipformer-host.py"),
    "--socket", socketPath,
    "--model-dir", resolve(directory),
    "--threads", String(threads),
    "--end-silence-sec", String(getVoiceDetectEndSilenceSeconds(env.VOICE_DETECT_END_SILENCE_SEC)),
  ], { detached: true, stdio: ["ignore", "inherit", "inherit"] });

  let running = true;
  const removeSocket = () => rmSync(socketDirectory, { recursive: true, force: true });
  child.once("error", (error) => {
    running = false;
    removeSocket();
    console.error("[Zipformer] Could not start the Python host:", error.message);
  });
  child.once("exit", (code, signal) => {
    if (running) console.warn(`[Zipformer] Python host stopped (${code ?? signal}).`);
    running = false;
    removeSocket();
  });
  child.unref();

  const cleanup = () => {
    if (running && child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
          console.warn("[Zipformer] Could not stop the Python host.");
        }
      }
    }
    running = false;
    removeSocket();
  };
  process.once("exit", cleanup);
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);

  const isReady = () => running && existsSync(socketPath);

  return {
    startRecordingStream(onPartial, onEndpoint) {
      return isReady() ? openZipformerStream(socketPath, onPartial, undefined, onEndpoint) : undefined;
    },
    async recognizeAudio(audioPath) {
      // A press during model loading still has a complete file to recognize once ready.
      const deadline = performance.now() + 15_000;
      while (running && !isReady() && performance.now() < deadline) await delay(100);
      if (!isReady()) {
        console.warn("[Zipformer] Python host is unavailable.");
        return "";
      }
      const result = await recognizeZipformerFile(socketPath, resolve(audioPath));
      if (result === undefined) console.warn("[Zipformer] Could not recognize the recording.");
      return result ?? "";
    },
  };
}
