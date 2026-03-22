/**
 * WebAudioBridge – singleton that bridges the WebDisplayServer WebSocket layer
 * with the audio recording/playback pipeline and the web-camera capture pipeline.
 *
 * Enabled via environment variables:
 *   WEB_AUDIO_ENABLED=true   – use browser microphone / speaker instead of ALSA
 *   WEB_CAMERA_ENABLED=true  – use browser camera instead of the Pi camera module
 *
 * Both features require WHISPLAY_WEB_ENABLED=true so that a WebDisplayServer is running.
 *
 * Binary WebSocket protocol (browser → server):
 *   Byte 0 = frame type
 *     0x01  audio chunk  (raw MediaRecorder/webm bytes)
 *     0x02  live camera JPEG frame (for streaming display)
 *     0x03  camera capture JPEG (high-quality single photo)
 *   Bytes 1..N = payload
 *
 * JSON WebSocket messages (server → browser):
 *   { type: "start_record" }
 *   { type: "stop_record"  }
 *   { type: "play_audio",    data: "<base64>", format: "wav|mp3|webm", duration: <ms> }
 *   { type: "stop_audio"   }
 *   { type: "start_camera_stream" }
 *   { type: "stop_camera_stream"  }
 *   { type: "capture_photo" }
 *
 * JSON WebSocket messages (browser → server):
 *   { type: "record_complete" }
 *   { type: "play_complete"   }
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { cameraFeedDir } from "../utils/dir";
import type { TTSResult } from "../type";

export type AudioFormat = "wav" | "mp3";

/** Minimal interface that WebDisplayServer must implement to be registered. */
export interface WebAudioBridgeServer {
  broadcastToWebClients(message: string | Buffer): void;
  getWebClientCount(): number;
}

interface RecordingState {
  outputPath: string;
  chunks: Buffer[];
  resolve: (p: string) => void;
  reject: (e: unknown) => void;
  timer: NodeJS.Timeout | null;
  stopRequested: boolean;
}

interface PlaybackState {
  playId: number;
  resolve: () => void;
  reject: (e: unknown) => void;
  timer: NodeJS.Timeout | null;
}

interface CaptureState {
  targetPath: string;
  resolve: (p: string) => void;
  reject: (e: unknown) => void;
  timer: NodeJS.Timeout | null;
}

// Prefix bytes for binary WebSocket frames (browser → server)
export const FRAME_AUDIO_CHUNK = 0x01;
export const FRAME_LIVE_CAMERA = 0x02;
export const FRAME_CAMERA_CAPTURE = 0x03;

class WebAudioBridge {
  private server: WebAudioBridgeServer | null = null;
  private recording: RecordingState | null = null;
  private playback: PlaybackState | null = null;
  private capture: CaptureState | null = null;
  private playIdCounter: number = 0;

  // ── Registration ──────────────────────────────────────────────────────────

  setServer(srv: WebAudioBridgeServer | null): void {
    this.server = srv;
  }

  // ── Feature flags ─────────────────────────────────────────────────────────

  isAudioEnabled(): boolean {
    return process.env.WEB_AUDIO_ENABLED === "true";
  }

  isCameraEnabled(): boolean {
    return process.env.WEB_CAMERA_ENABLED === "true";
  }

  /** Returns true when web audio is configured AND at least one browser is connected. */
  isAvailable(): boolean {
    return (
      this.isAudioEnabled() &&
      this.server !== null &&
      this.server.getWebClientCount() > 0
    );
  }

  /** Returns true when web camera is configured AND at least one browser is connected. */
  isCameraAvailable(): boolean {
    return (
      this.isCameraEnabled() &&
      this.server !== null &&
      this.server.getWebClientCount() > 0
    );
  }

  // ── Recording ─────────────────────────────────────────────────────────────

  /**
   * Start an automatic (voice-detect / timeout) recording from the browser.
   * @param outputPath  Path where the final audio file should be written.
   * @param durationSec Maximum recording duration in seconds.
   * @returns Promise that resolves with `outputPath` when recording finishes.
   */
  startRecording(outputPath: string, durationSec: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        return reject(new Error("WebAudioBridge: no server registered"));
      }
      this.abortCurrentRecording();

      const timer = setTimeout(() => {
        if (this.recording) {
          this.recording.stopRequested = true;
          this.server?.broadcastToWebClients(
            JSON.stringify({ type: "stop_record" }),
          );
          // Allow up to 800 ms for remaining chunks to arrive before assembling.
          setTimeout(() => this.finishRecording(), 800);
        }
      }, durationSec * 1000);

      this.recording = {
        outputPath,
        chunks: [],
        resolve,
        reject,
        timer,
        stopRequested: false,
      };
      this.server.broadcastToWebClients(JSON.stringify({ type: "start_record" }));
    });
  }

  /**
   * Start a manual recording from the browser.
   * @returns `result` promise + `stop()` function to end the recording.
   */
  startManualRecording(
    outputPath: string,
  ): { result: Promise<string>; stop: () => void } {
    let res!: (p: string) => void;
    let rej!: (e: unknown) => void;
    const result = new Promise<string>((r, j) => {
      res = r;
      rej = j;
    });

    if (!this.server) {
      setTimeout(() => rej(new Error("WebAudioBridge: no server registered")), 0);
      return { result, stop: () => {} };
    }

    this.abortCurrentRecording();
    this.recording = {
      outputPath,
      chunks: [],
      resolve: res,
      reject: rej,
      timer: null,
      stopRequested: false,
    };
    this.server.broadcastToWebClients(JSON.stringify({ type: "start_record" }));

    return { result, stop: () => this.stopRecording() };
  }

  /** Signal the browser to stop recording and wait for final data. */
  stopRecording(): void {
    if (!this.recording || this.recording.stopRequested) return;
    this.recording.stopRequested = true;
    this.server?.broadcastToWebClients(JSON.stringify({ type: "stop_record" }));
    setTimeout(() => this.finishRecording(), 800);
  }

  private abortCurrentRecording(): void {
    if (!this.recording) return;
    if (this.recording.timer) clearTimeout(this.recording.timer);
    this.recording.reject(new Error("Recording interrupted"));
    this.recording = null;
  }

  private finishRecording(): void {
    const rec = this.recording;
    if (!rec) return;
    this.recording = null;
    if (rec.timer) clearTimeout(rec.timer);

    if (rec.chunks.length === 0) {
      // Write an empty file so downstream code doesn't crash.
      try {
        fs.writeFileSync(rec.outputPath, Buffer.alloc(0));
      } catch {}
      return rec.resolve(rec.outputPath);
    }

    const allData = Buffer.concat(rec.chunks);
    const ext = path.extname(rec.outputPath).toLowerCase().slice(1);

    // If the target extension matches the browser's native webm/ogg output, write directly.
    if (ext === "webm" || ext === "ogg" || ext === "") {
      try {
        fs.writeFileSync(rec.outputPath, allData);
      } catch (e) {
        return rec.reject(e);
      }
      return rec.resolve(rec.outputPath);
    }

    // Attempt conversion via ffmpeg (webm → wav/mp3).
    const tempPath = rec.outputPath + ".webm";
    try {
      fs.writeFileSync(tempPath, allData);
    } catch (e) {
      return rec.reject(e);
    }

    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i",
      tempPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      rec.outputPath,
    ]);

    const cleanupAndResolve = (converted: boolean) => {
      try {
        fs.unlinkSync(tempPath);
      } catch {}
      if (!converted) {
        // Fallback: keep the webm file under the requested name.
        try {
          fs.copyFileSync(allData.length > 0 ? tempPath : rec.outputPath, rec.outputPath);
        } catch {}
        // Write allData directly since we already deleted tempPath above
        try {
          fs.writeFileSync(rec.outputPath, allData);
        } catch {}
      }
      rec.resolve(rec.outputPath);
    };

    ffmpeg.on("exit", (code) => cleanupAndResolve(code === 0));
    ffmpeg.on("error", () => {
      // ffmpeg not available – keep webm bytes under the target path name.
      try {
        fs.writeFileSync(rec.outputPath, allData);
        fs.unlinkSync(tempPath);
      } catch {}
      rec.resolve(rec.outputPath);
    });
  }

  // ── Handlers (called by WebDisplayServer on incoming binary WS data) ──────

  /** Append an audio data chunk from the browser. */
  handleAudioChunk(data: Buffer): void {
    if (this.recording) {
      this.recording.chunks.push(data);
    }
  }

  /** Browser signals that MediaRecorder has stopped; assemble the file. */
  handleRecordComplete(): void {
    if (this.recording?.stopRequested) {
      this.finishRecording();
    }
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  /**
   * Send TTS audio to the browser for playback.
   * @param params   TTS result with filePath, base64 or buffer + duration.
   * @param format   Audio format hint ("wav" | "mp3").
   */
  playAudioData(params: TTSResult, format: AudioFormat): Promise<void> {
    const { duration: audioDuration, filePath, base64, buffer } = params;
    if (audioDuration <= 0 || (!filePath && !base64 && !buffer)) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      if (!this.server) {
        return reject(new Error("WebAudioBridge: no server registered"));
      }

      this.stopCurrentPlayback();

      const playId = ++this.playIdCounter;

      // Timeout guard: resolve after duration + 5 s even if browser never confirms.
      const timer = setTimeout(() => {
        if (this.playback && this.playback.playId === playId) {
          this.playback = null;
          resolve();
        }
      }, audioDuration + 5000);

      this.playback = { playId, resolve, reject, timer };

      let audioBase64: string;
      let audioFormat: string = format;

      try {
        if (filePath) {
          const data = fs.readFileSync(filePath);
          audioBase64 = data.toString("base64");
          audioFormat =
            path.extname(filePath).slice(1).toLowerCase() || format;
        } else if (base64) {
          audioBase64 = base64;
        } else {
          audioBase64 = (buffer as Buffer).toString("base64");
        }
      } catch (e) {
        clearTimeout(timer);
        this.playback = null;
        return reject(e);
      }

      this.server.broadcastToWebClients(
        JSON.stringify({
          type: "play_audio",
          playId,
          data: audioBase64,
          format: audioFormat,
          duration: audioDuration,
        }),
      );
    });
  }

  /** Stop browser playback immediately. */
  stopPlayback(): void {
    this.server?.broadcastToWebClients(JSON.stringify({ type: "stop_audio" }));
    this.stopCurrentPlayback();
  }

  private stopCurrentPlayback(): void {
    if (!this.playback) return;
    const pb = this.playback;
    this.playback = null;
    if (pb.timer) clearTimeout(pb.timer);
    pb.resolve();
  }

  /** Browser signals that playback has finished. */
  handlePlayComplete(playId?: number): void {
    const pb = this.playback;
    if (!pb) return;
    // Ignore stale play_complete from a previous chunk.
    if (playId !== undefined && playId !== pb.playId) return;
    this.playback = null;
    if (pb.timer) clearTimeout(pb.timer);
    pb.resolve();
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  /**
   * Notify the browser whether it should stream live camera frames.
   * Called by WebDisplayServer when `camera_mode` changes.
   */
  notifyCameraStreamState(active: boolean): void {
    if (!this.server) return;
    this.server.broadcastToWebClients(
      JSON.stringify({
        type: active ? "start_camera_stream" : "stop_camera_stream",
      }),
    );
  }

  /**
   * Request a single high-quality photo from the browser camera.
   * @param targetPath Path where the captured JPEG should be saved.
   * @returns Promise that resolves with `targetPath` when the photo arrives.
   */
  requestCameraCapture(targetPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        return reject(new Error("WebAudioBridge: no server registered"));
      }

      if (this.capture) {
        if (this.capture.timer) clearTimeout(this.capture.timer);
        this.capture.reject(new Error("Capture interrupted"));
      }

      const timer = setTimeout(() => {
        if (this.capture) {
          const cap = this.capture;
          this.capture = null;
          cap.reject(new Error("Web camera capture timeout after 10 s"));
        }
      }, 10000);

      this.capture = { targetPath, resolve, reject, timer };
      this.server.broadcastToWebClients(JSON.stringify({ type: "capture_photo" }));
    });
  }

  /**
   * Save an incoming live camera frame to the shared web_live.jpg path so
   * the existing /camera HTTP endpoint can serve it unchanged.
   */
  handleLiveCameraFrame(data: Buffer): void {
    const framePath = path.join(cameraFeedDir, "web_live.jpg");
    const tempPath = framePath + ".tmp";
    try {
      fs.mkdirSync(path.dirname(framePath), { recursive: true });
      fs.writeFileSync(tempPath, data);
      fs.renameSync(tempPath, framePath);
    } catch {}
  }

  /** Save a browser-captured photo to the designated capture path. */
  handleCameraCaptureResult(data: Buffer): void {
    const cap = this.capture;
    if (!cap) return;
    this.capture = null;
    if (cap.timer) clearTimeout(cap.timer);

    try {
      fs.mkdirSync(path.dirname(cap.targetPath), { recursive: true });
      fs.writeFileSync(cap.targetPath, data);
      cap.resolve(cap.targetPath);
    } catch (e) {
      cap.reject(e);
    }
  }
}

export const webAudioBridge = new WebAudioBridge();
