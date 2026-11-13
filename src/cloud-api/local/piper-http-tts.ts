import * as fs from "fs";
import * as path from "path";
import { getAudioDurationInSeconds } from "get-audio-duration";
import { ChildProcess, execFile, spawn } from "child_process";
import { promisify } from "node:util";
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

const endpoint = (process.env.PIPER_HTTP_PATH || "").trim();
const baseUrl = /^https?:\/\//i.test(piperHttpHost) ? piperHttpHost : `http://${piperHttpHost}`;
const url = `${baseUrl}:${piperHttpPort}${endpoint && !endpoint.startsWith("/") ? "/" : ""}${endpoint}`;
const voice = (process.env.PIPER_HTTP_VOICE || "").trim();
const timeout = Number(process.env.PIPER_HTTP_TIMEOUT_SEC || "60");
const requestTimeout = Number.isFinite(timeout) && timeout > 0 ? timeout : 60;
const run = promisify(execFile);
let requestSequence = 0;

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
    pyProcess.on("error", (error: NodeJS.ErrnoException) => console.error("Could not start Piper HTTP server:", error.code));
  }
}

const piperHttpTTS = async (text: string): Promise<TTSResult> => {
  const id = `${Date.now()}_${process.pid}_${++requestSequence}`;
  const raw = path.join(ttsDir, `piper_http_${id}.wav`);
  const converted = path.join(ttsDir, `piper_http_${id}_converted.wav`);
  let ready = false;
  try {
    const { stdout } = await run("curl", [
      "-sS", "--connect-timeout", "5", "--max-time", String(requestTimeout),
      "--write-out", "%{http_code}", "-H", "Content-Type: application/json",
      "--data-binary", JSON.stringify({ text, length_scale: Number(piperHttpLengthScale), ...(voice ? { voice } : {}) }),
      "-o", raw, url,
    ]);
    if (stdout.trim() !== "200") throw new Error(`Piper HTTP status ${stdout.trim()}`);
    const handle = await fs.promises.open(raw, "r");
    try {
      const header = Buffer.alloc(12);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (bytesRead !== 12 || header.toString("ascii", 0, 4) !== "RIFF" ||
          header.toString("ascii", 8, 12) !== "WAVE") {
        throw new Error("Piper returned no WAV audio");
      }
    } finally {
      await handle.close();
    }

    // Preserve the format required by the unified Whisplay ALSA device.
    await run("sox", ["-v", "0.9", raw, "-r", "48000", "-c", "2", "-b", "16", converted]);
    const duration = (await getAudioDurationInSeconds(converted)) * 1000;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Invalid WAV duration");
    ready = true;
    return { filePath: converted, duration };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    // Child-process errors can contain the input text in the command line.
    console.error("Piper synthesis failed:", failure.code ?? failure.message);
    return { duration: 0 };
  } finally {
    for (const file of ready ? [raw] : [raw, converted]) {
      try {
        await fs.promises.unlink(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn("Could not remove Piper temporary audio");
        }
      }
    }
  }
};

function cleanup() {
  if (pyProcess?.pid && pyProcess.exitCode === null && pyProcess.signalCode === null && !pyProcess.killed) {
    console.log("Killing python server...");
    try {
      process.kill(-pyProcess.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") console.error("Could not stop Piper HTTP server");
    }
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
