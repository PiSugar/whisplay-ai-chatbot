import { EventEmitter } from "events";
import { spawn, ChildProcess } from "child_process";
import { resolve } from "path";
import dotenv from "dotenv";
dotenv.config();

const pythonBinary = process.env.WAKE_WORD_PYTHON_PATH || "python3";

export class WakeWordListener extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer: string = "";

  start(): void {
    if (this.process) return;
    const enabled = (process.env.WAKE_WORD_ENABLED || "").toLowerCase();
    if (enabled !== "true") return;

    const scriptPath = resolve(__dirname, "../../python/wakeword.py");
    this.process = spawn(pythonBinary, [scriptPath], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      let newlineIndex = this.buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (line.startsWith("WAKE")) {
          this.emit("wake", line);
        } else if (line) {
          console.log(`[WakeWord] ${line}`);
        }
        newlineIndex = this.buffer.indexOf("\n");
      }
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        console.error(`[WakeWord] ${message}`);
      }
    });

    this.process.on("close", (code) => {
      console.log(`[WakeWord] process exited with code ${code}`);
      this.process = null;
    });
  }

  stop(): void {
    if (!this.process) return;
    this.process.kill("SIGTERM");
    this.process = null;
  }
}
