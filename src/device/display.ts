import { exec } from "child_process";
import { resolve } from "path";
import { Socket } from "net";
import { getCurrentTimeTag } from "../utils";
import { WebDisplayServer } from "./web-display";
import dotEnv from "dotenv";

dotEnv.config();

export interface Status {
  status: string;
  emoji: string;
  text: string;
  scroll_speed: number;
  scroll_sync?: {
    char_end: number;
    duration_ms: number;
  };
  brightness: number;
  RGB: string;
  battery_color: string;
  battery_level: number | undefined;
  image: string;
  camera_mode: boolean;
  camera_capture?: boolean;
  capture_image_path: string;
  network_connected: boolean;
  rag_icon_visible: boolean;
}

export class WhisplayDisplay {
  private currentStatus: Status = {
    status: "starting",
    emoji: "😊",
    text: "",
    scroll_speed: 3,
    scroll_sync: undefined,
    brightness: 100,
    RGB: "#00FF30",
    battery_color: "#000000",
    battery_level: undefined,
    image: "",
    camera_mode: false,
    capture_image_path: "",
    network_connected: false,
    rag_icon_visible: false,
  };

  private client = null as Socket | null;
  private buttonPressedCallback: () => void = () => {};
  private buttonReleasedCallback: () => void = () => {};
  private buttonDoubleClickCallback: (() => void) | null = null;
  private onCameraCaptureCallback: () => void = () => {};
  private isReady: Promise<void>;
  private pythonProcess: any; // Placeholder for Python process if needed
  private buttonPressTimeArray: number[] = [];
  private buttonReleaseTimeArray: number[] = [];
  private buttonDetectInterval: NodeJS.Timeout | null = null;
  private webDisplay: WebDisplayServer | null = null;
  private deviceEnabled: boolean;
  private cameraEnabled: boolean;

  constructor() {
    this.deviceEnabled = parseBoolEnv("WHISPLAY_DEVICE_ENABLED", true);
    this.cameraEnabled = parseBoolEnv("ENABLE_CAMERA", false);
    if (this.cameraEnabled) {
      this.ensureCameraDaemon();
    }
    const webEnabled = parseBoolEnv("WHISPLAY_WEB_ENABLED", false);
    if (webEnabled) {
      const port = parseInt(process.env.WHISPLAY_WEB_PORT || "17880", 10);
      const host = process.env.WHISPLAY_WEB_HOST || "0.0.0.0";
      this.webDisplay = new WebDisplayServer({
        host,
        port,
        onButtonPress: () => this.handleButtonPressedEvent(),
        onButtonRelease: () => this.handleButtonReleasedEvent(),
      });
      this.webDisplay.updateStatus(this.currentStatus);
    }

    if (this.deviceEnabled) {
      this.startPythonProcess();
      this.isReady = new Promise<void>((resolve) => {
        this.connectWithRetry(15, resolve);
      });
    } else {
      this.isReady = Promise.resolve();
    }
  }

  startMonitoringDoubleClick(): void {
    if (this.buttonDetectInterval || !this.buttonDoubleClickCallback) return;
    // check if there are two presses and two releases
    this.buttonDetectInterval = setTimeout(() => {
      // clean old click arrays >= 1500ms
      const now = Date.now();
      this.buttonPressTimeArray = this.buttonPressTimeArray.filter(
        (time) => now - time <= 1000,
      );
      this.buttonReleaseTimeArray = this.buttonReleaseTimeArray.filter(
        (time) => now - time <= 1000,
      );
      const doubleClickDetected =
        this.buttonPressTimeArray.length >= 2 &&
        this.buttonReleaseTimeArray.length >= 2;

      if (doubleClickDetected) {
        this.buttonDoubleClickCallback?.();
      } else {
        const lastReleaseTime = this.buttonReleaseTimeArray.pop() || 0;
        const lastPressTime = this.buttonPressTimeArray.pop() || 0;
        if (!lastReleaseTime || lastReleaseTime < lastPressTime) {
          this.buttonPressedCallback();
        }
      }

      // reset arrays and interval
      this.buttonPressTimeArray = [];
      this.buttonReleaseTimeArray = [];
      this.buttonDetectInterval = null;
    }, 800);
  }

  startPythonProcess(): void {
    if (!this.deviceEnabled) {
      return;
    }
    const command = `cd ${resolve(
      __dirname,
      "../../python",
    )} && python3 chatbot-ui.py`;
    console.log("Starting Python process...");
    this.pythonProcess = exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error("Error starting Python process:", error);
        return;
      }
      console.log("Python process stdout:", stdout);
      console.error("Python process stderr:", stderr);
    });
    this.pythonProcess.stdout.on("data", (data: any) =>
      console.log(data.toString()),
    );
    this.pythonProcess.stderr.on("data", (data: any) =>
      console.error(data.toString()),
    );
  }

  killPythonProcess(): void {
    if (!this.deviceEnabled) {
      return;
    }
    if (this.pythonProcess) {
      console.log("Killing Python process...", this.pythonProcess.pid);
      this.pythonProcess.kill();
      process.kill(this.pythonProcess.pid, "SIGKILL");
      this.pythonProcess = null;
    }
  }

  async connectWithRetry(
    retries: number = 10,
    outerResolve: () => void,
  ): Promise<void> {
    if (!this.deviceEnabled) {
      outerResolve();
      return;
    }
    await new Promise((resolve, reject) => {
      const attemptConnection = (attempt: number) => {
        this.connect()
          .then(() => {
            resolve(true);
          })
          .catch((err) => {
            if (attempt < retries) {
              console.log(`Connection attempt ${attempt} failed, retrying...`);
              setTimeout(() => attemptConnection(attempt + 1), 5000);
            } else {
              console.error("Failed to connect after multiple attempts:", err);
              reject(err);
            }
          });
      };
      attemptConnection(1);
    });
    outerResolve();
  }

  async connect(): Promise<void> {
    console.log("Connecting to local display socket...");
    return new Promise<void>((resolve, reject) => {
      // 销毁原来的this.client
      if (this.client) {
        this.client.destroy();
      }
      this.client = new Socket();
      this.client.connect(12345, "0.0.0.0", () => {
        console.log("Connected to local display socket");
        this.sendToDisplay(JSON.stringify(this.currentStatus));
        resolve();
      });
      this.client.on("data", (data: Buffer) => {
        const dataString = data.toString();
        if (dataString.trim() === "OK") {
          return;
        }
        console.log(
          `[${getCurrentTimeTag()}] Received data from Whisplay hat:`,
          dataString,
        );
        try {
          const json = JSON.parse(dataString);
          if (json.event === "button_pressed") {
            this.handleButtonPressedEvent();
          }
          if (json.event === "button_released") {
            this.handleButtonReleasedEvent();
          }
          if (json.event === "camera_capture") {
            this.handleCameraCaptureEvent();
          }
        } catch {
          // console.error("Failed to parse JSON from data");
        }
      });
      this.client.on("error", (err: any) => {
        // 如果是ECONNREFUSED
        if (err.code === "ECONNREFUSED") {
          reject(err);
        }
      });
    });
  }

  onButtonPressed(callback: () => void): void {
    this.buttonPressedCallback = callback;
  }

  onButtonReleased(callback: () => void): void {
    this.buttonReleasedCallback = callback;
  }

  onButtonDoubleClick(callback: (() => void) | null): void {
    this.buttonDoubleClickCallback = callback || null;
  }

  onCameraCapture(callback: () => void): void {
    this.onCameraCaptureCallback = callback;
  }

  private async sendToDisplay(data: string): Promise<void> {
    if (!this.deviceEnabled) {
      return;
    }
    await this.isReady;
    try {
      this.client?.write(`${data}\n`, "utf8", () => {
        // console.log("send", data);
      });
    } catch (error) {
      console.error("Failed to update display.");
    }
  }

  getCurrentStatus(): Status {
    return this.currentStatus;
  }

  async display(newStatus: Partial<Status> = {}): Promise<void> {
    const {
      status,
      emoji,
      text,
      RGB,
      brightness,
      scroll_sync,
      battery_level,
      battery_color,
      image,
      network_connected,
      rag_icon_visible,
    } = {
      ...this.currentStatus,
      ...newStatus,
    };

    const changedValues = Object.entries(newStatus).filter(
      ([key, value]) => (this.currentStatus as any)[key] !== value,
    );

    const isTextChanged = changedValues.some(([key]) => key === "text");

    this.currentStatus.status = status;
    this.currentStatus.emoji = emoji;
    this.currentStatus.text = text;
    this.currentStatus.RGB = RGB;
    this.currentStatus.brightness = brightness;
    this.currentStatus.scroll_sync = scroll_sync;
    this.currentStatus.battery_level = battery_level;
    this.currentStatus.battery_color = battery_color;
    this.currentStatus.image = image;
    this.currentStatus.network_connected = network_connected;
    this.currentStatus.rag_icon_visible = rag_icon_visible;
    
    const changedValuesObj = Object.fromEntries(changedValues);
    changedValuesObj.brightness = 100;
    const data = JSON.stringify(changedValuesObj);
    if (isTextChanged) console.log("send data:", data);

    if (!this.deviceEnabled && newStatus.camera_capture) {
      const capturePath = newStatus.capture_image_path || this.currentStatus.capture_image_path;
      if (capturePath) {
        this.sendCameraDaemonCommand("capture", { path: capturePath });
        this.handleCameraCaptureEvent();
      }
    }

    this.sendToDisplay(data);
    this.webDisplay?.updateStatus(this.currentStatus);
  }

  private handleButtonPressedEvent(): void {
    this.buttonPressTimeArray.push(Date.now());
    this.startMonitoringDoubleClick();
    if (!this.buttonDetectInterval) {
      console.log("emit pressed");
      this.buttonPressedCallback();
    }
  }

  private handleButtonReleasedEvent(): void {
    this.buttonReleaseTimeArray.push(Date.now());
    if (!this.buttonDetectInterval) {
      console.log("emit released");
      this.buttonReleasedCallback();
    }
  }

  private handleCameraCaptureEvent(): void {
    this.onCameraCaptureCallback();
  }

  stopWebDisplay(): void {
    this.webDisplay?.close();
    this.webDisplay = null;
  }

  private ensureCameraDaemon(): void {
    const command = `cd ${resolve(
      __dirname,
      "../../python",
    )} && python3 camera.py --ensure-daemon`;
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.warn("[CameraDaemon] ensure failed:", error.message);
        return;
      }
      if (stdout?.trim()) {
        console.log(stdout.trim());
      }
      if (stderr?.trim()) {
        console.warn(stderr.trim());
      }
    });
  }

  private sendCameraDaemonCommand(
    cmd: string,
    payload: Record<string, unknown> = {},
  ): void {
    const port = parseInt(process.env.WHISPLAY_CAMERA_DAEMON_PORT || "18765", 10);
    const socket = new Socket();
    socket.setTimeout(1000);
    socket.connect(port, "127.0.0.1", () => {
      socket.write(`${JSON.stringify({ cmd, ...payload })}\n`);
      socket.end();
    });
    socket.on("error", () => {
      socket.destroy();
    });
    socket.on("timeout", () => {
      socket.destroy();
    });
  }
}

// Create a singleton instance to maintain backward compatibility
const displayInstance = new WhisplayDisplay();

export const display = displayInstance.display.bind(displayInstance);
export const getCurrentStatus =
  displayInstance.getCurrentStatus.bind(displayInstance);
export const onButtonPressed =
  displayInstance.onButtonPressed.bind(displayInstance);
export const onButtonReleased =
  displayInstance.onButtonReleased.bind(displayInstance);
export const onButtonDoubleClick =
  displayInstance.onButtonDoubleClick.bind(displayInstance);
export const onCameraCapture =
  displayInstance.onCameraCapture.bind(displayInstance);

function cleanup() {
  console.log("Cleaning up display process before exit...");
  displayInstance.killPythonProcess();
  displayInstance.stopWebDisplay();
}

// kill the Python process on exit signals
process.on("exit", cleanup);
["SIGINT", "SIGTERM"].forEach((signal) => {
  process.on(signal, () => {
    console.log(`Received ${signal}, exiting...`);
    cleanup();
    process.exit(0);
  });
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  cleanup();
  process.exit(1);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  cleanup();
  process.exit(1);
});
process.on("keyboardInterrupt", () => {
  console.log("Keyboard Interrupt received, killing Python process...");
  cleanup();
  process.exit(0);
});

function parseBoolEnv(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (!raw) {
    return defaultValue;
  }
  return raw.toLowerCase() === "true" || raw === "1";
}
