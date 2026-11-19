import { spawn, ChildProcess } from "child_process";
import { createWriteStream, promises as fs } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isEmpty, noop, set } from "lodash";
import dotenv from "dotenv";
import { ttsServer, asrServer } from "../cloud-api/server";
import { pluginRegistry } from "../plugin";
import type { ASRPlugin, TTSPlugin, AudioFormat } from "../plugin";
import { ASRServer, TTSResult, TTSServer } from "../type";
import { alsaInputDevice, alsaOutputDevice } from "./audio-device";
import { webAudioBridge } from "./web-audio-bridge";
import { pcm16WavHeader, VOICE_PCM_SAMPLE_RATE } from "../utils/pcm-wav";
import { getVoiceDetectEndLevel } from "./voice-detect";
import { getVoiceDetectEndSilenceSeconds } from "../config/auto-listening";

export { getDynamicVoiceDetectLevel } from "./voice-detect";

dotenv.config();

const normalizeAudioFormat = (value: string | undefined, fallback: AudioFormat): AudioFormat => {
  const normalized = (value || "").toLowerCase();
  return normalized === "wav" || normalized === "mp3" ? normalized : fallback;
};

const defaultTtsAudioFormat: AudioFormat = [TTSServer.gemini, TTSServer.piper].includes(ttsServer)
  ? "wav"
  : "mp3";

const selectedTtsPlugin = pluginRegistry.getPlugin("tts", ttsServer) as TTSPlugin | undefined;
const ttsAudioFormat: AudioFormat = normalizeAudioFormat(
  selectedTtsPlugin?.audioFormat,
  defaultTtsAudioFormat,
);

const MP3_SOX_GAIN_DB = "2";
const voiceDetectEndSilenceSec = getVoiceDetectEndSilenceSeconds(process.env.VOICE_DETECT_END_SILENCE_SEC);
const voiceDetectEndLevelRatioRaw = parseFloat(
  process.env.VOICE_DETECT_END_LEVEL_RATIO || "0.5",
);
const voiceDetectEndLevelRatio =
  Number.isFinite(voiceDetectEndLevelRatioRaw) && voiceDetectEndLevelRatioRaw > 0
    ? voiceDetectEndLevelRatioRaw
    : 0.5;

const defaultAsrAudioFormat: AudioFormat = [
  ASRServer.vosk,
  ASRServer.whisper,
  ASRServer.whisperhttp,
  ASRServer.fasterwhisper,
  ASRServer.zipformer,
  ASRServer.llm8850whisper,
].includes(asrServer)
  ? "wav"
  : "mp3";

const selectedAsrPlugin = pluginRegistry.getPlugin("asr", asrServer) as ASRPlugin | undefined;

export const recordFileFormat: AudioFormat = normalizeAudioFormat(
  selectedAsrPlugin?.audioFormat,
  defaultAsrAudioFormat,
);

let recordingProcessList: ChildProcess[] = [];
let currentRecordingReject: (reason?: any) => void = noop;

const removeRecordingProcess = (child: ChildProcess): void => {
  recordingProcessList = recordingProcessList.filter((item) => item !== child);
};

const killRecordingProcess = (child: ChildProcess): void => {
  console.log("Killing recording process", child.pid);
  try {
    child.kill("SIGINT");
  } catch (e) { }
  removeRecordingProcess(child);
};

const killAllRecordingProcesses = (): void => {
  recordingProcessList.forEach((child) => {
    killRecordingProcess(child);
  });
  recordingProcessList.length = 0;
};

export const playWakeupChime = (): Promise<void> => {
  return new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) {
        return;
      }
      finished = true;
      resolve();
    };

    //     play -n \
    // synth 0.10 sine 720 vol 0.4 : \
    // synth 0.12 sine 980 vol 0.35 : \
    // synth 0.14 sine 1320 vol 0.3 \
    // fade q 0.02 0.30 0.08 gain -30

    const chimeProcess = spawn("sox", [
      "-q",
      "-n",
      "-t",
      "alsa",
      alsaOutputDevice,
      "synth",
      "0.10",
      "sine",
      "720",
      "vol",
      "0.4",
      ":",
      "synth",
      "0.12",
      "sine",
      "980",
      "vol",
      "0.35",
      ":",
      "synth",
      "0.14",
      "sine",
      "1320",
      "vol",
      "0.3",
      "fade",
      "q",
      "0.02",
      "0.30",
      "0.08",
      "gain",
      "-30",
    ]);

    chimeProcess.on("error", done);
    chimeProcess.on("exit", done);

    setTimeout(done, 1500);
  });
};

const recordAudio = async (
  outputPath: string,
  duration: number = 10,
  voiceDetectLevel: number = 30,
  signal?: AbortSignal,
  onPcm?: (audio: Buffer) => void,
  finishSignal?: AbortSignal,
): Promise<string> => {
  if (signal?.aborted) throw signal.reason;
  // Delegate to browser microphone when web audio is enabled and a client is connected.
  if (webAudioBridge.isAvailable()) {
    console.log(`[WebAudio] Starting browser recording, max ${duration} seconds...`);
    return webAudioBridge.startRecording(outputPath, duration, {
      silenceMs: voiceDetectEndSilenceSec * 1000,
      endLevelRatio: voiceDetectEndLevelRatio,
    }, signal);
  }

  const voiceDetectEndLevel = getVoiceDetectEndLevel(voiceDetectLevel, voiceDetectEndLevelRatio);
  const silence = [
    "silence", "1", "0.1", `${voiceDetectLevel}%`,
    "1", String(voiceDetectEndSilenceSec), `${voiceDetectEndLevel}%`,
  ];
  console.log(
    `Starting recording, maximum ${duration} seconds (start=${voiceDetectLevel}%, stop=${voiceDetectEndLevel}% for ${voiceDetectEndSilenceSec}s)...`,
  );
  if (onPcm) {
    const capture = recordPcm(outputPath, onPcm, silence);
    const timer = setTimeout(capture.stop, duration * 1000);
    const finishAtEndpoint = () => {
      console.log("[Audio] Stopping automatic recording at ASR endpoint");
      capture.stop();
    };
    signal?.addEventListener("abort", capture.stop, { once: true });
    finishSignal?.addEventListener("abort", finishAtEndpoint, { once: true });
    if (finishSignal?.aborted) finishAtEndpoint();
    try {
      return await capture.result;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", capture.stop);
      finishSignal?.removeEventListener("abort", finishAtEndpoint);
      if (signal?.aborted) throw signal.reason;
    }
  }

  return new Promise((resolve, reject) => {
    const args = [
      "-t",
      "alsa",
      alsaInputDevice,
      "-t",
      recordFileFormat,
      "-c",
      "1",
      "-r",
      "16000",
      outputPath,
      ...silence,
    ];
    currentRecordingReject = reject;
    const recordingProcess = spawn("sox", args);

    let recordingError: Error | undefined;
    let timedOut = false;
    const abort = () => killRecordingProcess(recordingProcess);
    recordingProcess.on("error", (error) => { recordingError = error; });

    recordingProcess.stdout?.on("data", (data) => {
      console.log(data.toString());
    });
    recordingProcess.stderr?.on("data", (data) => {
      console.error(data.toString());
    });

    recordingProcess.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      removeRecordingProcess(recordingProcess);
      if (signal?.aborted) {
        reject(signal.reason);
      } else if (recordingError || (code && !timedOut)) {
        reject(recordingError ?? code);
      } else {
        resolve(outputPath);
      }
    });
    recordingProcessList.push(recordingProcess);

    // Set a timeout to kill the recording process after the specified duration
    const timer = setTimeout(() => {
      if (signal?.aborted) return;
      timedOut = true;
      killRecordingProcess(recordingProcess);
    }, duration * 1000);
    signal?.addEventListener("abort", abort, { once: true });
  });
};

export const canStreamRecording = () =>
  recordFileFormat === "wav" && !webAudioBridge.isAvailable();

const recordPcm = (outputPath: string, onPcm: (audio: Buffer) => void, effects: string[] = []) => {
  const child = spawn("sox", [
    "--buffer", "2048", "-t", "alsa", alsaInputDevice, "-t", "raw", "-c", "1", "-r",
    String(VOICE_PCM_SAMPLE_RATE),
    "-e", "signed-integer", "-b", "16", "-L", "-", ...effects,
  ]);
  const destination = createWriteStream(outputPath);
  destination.write(pcm16WavHeader(0, VOICE_PCM_SAMPLE_RATE, 1));
  let byteLength = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteLength += chunk.length;
      onPcm(chunk);
      callback(null, chunk);
    },
  });
  let stopRequested = false;
  const stop = () => {
    if (stopRequested) return;
    stopRequested = true;
    killRecordingProcess(child);
  };
  const captureDone = new Promise<void>((resolve, reject) => {
    currentRecordingReject = reject;
    let spawnError: Error | undefined;
    child.once("error", error => { spawnError = error; });
    child.once("close", (code, signal) => {
      removeRecordingProcess(child);
      if (spawnError) {
        reject(spawnError);
      } else if (code === 0 || (stopRequested && (signal === "SIGINT" || code === 2 || code === 130))) {
        resolve();
      } else {
        reject(new Error(`SoX recording exited with ${code ?? signal}`));
      }
    });
  });
  child.stderr.on("data", (data) => console.error(data.toString()));
  recordingProcessList.push(child);
  const saved = pipeline(child.stdout, tap, destination).catch(error => {
    stop();
    throw error;
  });
  const result = Promise.allSettled([captureDone, saved])
    .then(async ([capture, fileWrite]) => {
      if (fileWrite.status === "rejected") throw fileWrite.reason;
      if (capture.status === "rejected") throw capture.reason;
      const file = await fs.open(outputPath, "r+");
      try {
        const alignedLength = byteLength - byteLength % 2;
        if (alignedLength !== byteLength) await file.truncate(44 + alignedLength);
        await file.write(pcm16WavHeader(alignedLength, VOICE_PCM_SAMPLE_RATE, 1), 0, 44, 0);
      } finally {
        await file.close();
      }
      return outputPath;
    });
  return { result, stop };
};

const recordAudioManually = (
  outputPath: string, onPcm?: (audio: Buffer) => void,
): { result: Promise<string>; stop: () => void } => {
  // Delegate to browser microphone when web audio is enabled and a client is connected.
  if (webAudioBridge.isAvailable()) {
    console.log(`[WebAudio] Starting manual browser recording...`);
    return webAudioBridge.startManualRecording(outputPath);
  }
  if (onPcm) return recordPcm(outputPath, onPcm);

  let stopFunc: () => void = noop;
  const result = new Promise<string>((resolve, reject) => {
    currentRecordingReject = reject;
    const recordingProcess = spawn("sox", [
      "-t",
      "alsa",
      alsaInputDevice,
      "-t",
      recordFileFormat,
      "-c",
      "1",
      "-r",
      "16000",
      outputPath,
    ]);

    recordingProcess.on("error", (err) => {
      removeRecordingProcess(recordingProcess);
      reject(err);
    });

    recordingProcess.stderr?.on("data", (data) => {
      console.error(data.toString());
    });
    recordingProcessList.push(recordingProcess);
    stopFunc = () => {
      killRecordingProcess(recordingProcess);
    };
    recordingProcess.on("exit", () => {
      removeRecordingProcess(recordingProcess);
      resolve(outputPath);
    });
  });
  return {
    result,
    stop: stopFunc,
  };
};

const stopRecording = (): void => {
  // Also stop any in-progress web recording.
  webAudioBridge.stopRecording();

  if (!isEmpty(recordingProcessList)) {
    killAllRecordingProcesses();
    try {
      currentRecordingReject();
    } catch (e) { }
    console.log("Recording stopped");
  } else {
    console.log("No recording process running");
  }
};

interface ActivePlayback {
  stop(): void;
  closed: Promise<void>;
}

const activePlaybacks = new Set<ActivePlayback>();

const playAudioData = (params: TTSResult): Promise<void> => {
  if (webAudioBridge.isAvailable()) {
    return webAudioBridge.playAudioData(params, ttsAudioFormat);
  }

  const { duration, filePath, base64, buffer } = params;
  if (duration <= 0 || (!filePath && !base64 && !buffer)) return Promise.resolve();

  const input = filePath ? [filePath] : ["-t", ttsAudioFormat, "-"];
  const effects = !filePath && ttsAudioFormat === "mp3" ? ["gain", MP3_SOX_GAIN_DB] : [];
  const child = spawn("sox", ["-q", ...input, "-t", "alsa", alsaOutputDevice, ...effects]);
  let interrupted = false;
  let markClosed: () => void = noop;
  const playback: ActivePlayback = {
    stop() {
      if (interrupted || child.exitCode !== null || child.signalCode !== null) return;
      interrupted = true;
      // Closing ALSA abruptly discards queued playback instead of draining it into the mic.
      child.kill("SIGKILL");
    },
    closed: new Promise<void>((resolve) => { markClosed = resolve; }),
  };
  activePlaybacks.add(playback);

  const completion = new Promise<void>((resolve, reject) => {
    let failure: Error | undefined;
    let stderr = "";
    const watchdog = setTimeout(() => {
      console.error("Audio playback timed out.");
      playback.stop();
    }, duration + (filePath ? 1000 : 2000));

    child.on("error", (error) => { failure = error; });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.once("close", (code, signal) => {
      clearTimeout(watchdog);
      activePlaybacks.delete(playback);
      markClosed();
      if (interrupted || code === 0) {
        resolve();
      } else {
        reject(failure ?? new Error(`SoX playback exited with ${code ?? signal}${stderr ? `: ${stderr.trim()}` : ""}`));
      }
    });
    child.stdin.on("error", (error) => {
      if (!interrupted) failure = error;
    });
    child.stdin.end(filePath ? undefined : base64 ? Buffer.from(base64, "base64") : buffer);
  });

  return completion;
};

const stopPlaying = (): void => {
  webAudioBridge.stopPlayback();
  for (const playback of activePlaybacks) playback.stop();
};

export const waitForPlaybackToStop = (): Promise<void> | undefined => {
  if (!activePlaybacks.size) return;
  return Promise.all([...activePlaybacks].map((playback) => playback.closed)).then(() => {});
};

process.on("SIGINT", () => {
  stopPlaying();
  process.exit();
});

// Music playback retains its ALSA settling period after interrupting TTS.
const releaseAudioPlayer = async (): Promise<void> => {
  const closed = waitForPlaybackToStop();
  if (!closed) return;
  stopPlaying();
  await closed;
  await new Promise((resolve) => setTimeout(resolve, 500));
};

// TTS opens ALSA on demand for each segment.
const restoreAudioPlayer = noop;

export {
  recordAudio,
  recordAudioManually,
  stopRecording,
  playAudioData,
  stopPlaying,
  releaseAudioPlayer,
  restoreAudioPlayer,
};
