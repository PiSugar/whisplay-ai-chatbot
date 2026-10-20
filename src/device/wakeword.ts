import { EventEmitter } from "events";
import { spawn, ChildProcess } from "child_process";
import { resolve } from "path";
import dotenv from "dotenv";
dotenv.config();

const pythonBinary = process.env.WAKE_WORD_PYTHON_PATH || "python3";

export class WakeWordListener extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer: string = "";
  private stopping: Promise<void> | null = null;
  private wakePending: boolean = false;

  start(): void {
    const enabled = (process.env.WAKE_WORD_ENABLED || "").toLowerCase();
    if (enabled !== "true") return;

    if (this.stopping) {
      void this.stopping.then(() => this.start());
      return;
    }
    if (this.process) return;

    const scriptPath = resolve(__dirname, "../../python/wakeword.py");
    const child = spawn(pythonBinary, [scriptPath], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.process = child;
    this.buffer = "";
    this.wakePending = false;

    child.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      let newlineIndex = this.buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (line.startsWith("WAKE") && !this.wakePending) {
          this.wakePending = true;
          // The wake-word process owns the capture device. Do not notify the
          // chat flow until it and its SoX child have released the microphone.
          void this.stop().then(() => this.emit("wake", line));
        } else if (line) {
          console.log(`[WakeWord] ${line}`);
        }
        newlineIndex = this.buffer.indexOf("\n");
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        console.error(`[WakeWord] ${message}`);
      }
    });

    child.on("close", (code) => {
      console.log(`[WakeWord] process exited with code ${code}`);
      if (this.process === child) {
        this.process = null;
      }
    });
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const child = this.process;
    if (!child) return Promise.resolve();

    this.stopping = new Promise<void>((resolveStop) => {
      let finished = false;
      let forceKillTimer: ReturnType<typeof setTimeout>;
      let forceKillFallbackTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(forceKillTimer);
        if (forceKillFallbackTimer) {
          clearTimeout(forceKillFallbackTimer);
        }
        if (this.process === child) {
          this.process = null;
        }
        this.stopping = null;
        resolveStop();
      };
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
          forceKillFallbackTimer = setTimeout(finish, 250);
          return;
        }
        finish();
      }, 1500);

      child.once("exit", finish);
      child.once("error", finish);
      child.kill("SIGTERM");
    });
    return this.stopping;
  }
}
