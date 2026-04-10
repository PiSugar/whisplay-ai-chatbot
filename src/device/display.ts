import { exec } from "child_process";
import { resolve } from "path";
import { Socket } from "net";
import { getCurrentTimeTag } from "../utils";
import { WebDisplayServer } from "./web-display";
import { webAudioBridge } from "./web-audio-bridge";
import dotEnv from "dotenv";

dotEnv.config();

export interface Status {
  status: string;
  emoji: string;
  text: string;
  text_input_enabled?: boolean;
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
  vpn_connected: boolean;
  rag_icon_visible: boolean;
  image_icon_visible: boolean;
  music_progress: number | undefined;
  music_duration_ms: number | undefined;
}

export class WhisplayDisplay {
  private currentStatus: Status = {
    status: "starting",
    emoji: "😊",
    text: "",
    text_input_enabled: false,
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
    vpn_connected: false,
    rag_icon_visible: false,
    image_icon_visible: false,
    music_progress: undefined,
    music_duration_ms: undefined,
  };

  private client = null as Socket | null;
  private buttonPressedCallback: () => void = () => {};
  private buttonReleasedCallback: () => void = () => {};
  private buttonDoubleClickCallback: (() => void) | null = null;
  private buttonDown = false;
  private onCameraCaptureCallback: () => void = () => {};
  private textInputCallback: (text: string) => void = () => {};
  private isReady: Promise<void>;
  private pythonProcess: any; // Placeholder for Python process if needed
  private buttonPressTimeArray: number[] = [];
  private buttonReleaseTimeArray: number[] = [];
  private buttonDetectInterval: NodeJS.Timeout | null = null;
  private webDisplay: WebDisplayServer | null = null;
  private deviceEnabled: boolean;
  private cameraEnabled: boolean;
  private receiveBuffer = "";
  private textCounterTimer: NodeJS.Timeout | null = null;
  private textCounterTemplate: string | null = null;
  private textCounterStartAt = 0;

  constructor() {
    this.deviceEnabled = parseBoolEnv("WHISPLAY_DEVICE_ENABLED", true);
    this.cameraEnabled = parseBoolEnv("ENABLE_CAMERA", false);
    const webCameraEnabled = parseBoolEnv("WEB_CAMERA_ENABLED", false);
    if (this.cameraEnabled && !webCameraEnabled) {
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
        onTextInput: (text: string) => this.handleTextInputEvent(text),
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
        this.receiveBuffer = "";
        this.sendToDisplay(JSON.stringify(this.currentStatus));
        resolve();
      });
      this.client.on("data", (data: Buffer) => {
        this.receiveBuffer += data.toString();
        while (this.receiveBuffer.includes("\n")) {
          const newlineIndex = this.receiveBuffer.indexOf("\n");
          const line = this.receiveBuffer.slice(0, newlineIndex).trim();
          this.receiveBuffer = this.receiveBuffer.slice(newlineIndex + 1);
          if (!line || line === "OK") {
            continue;
          }
          console.log(
            `[${getCurrentTimeTag()}] Received data from Whisplay hat:`,
            line,
          );
          try {
            const json = JSON.parse(line);
            if (json.event === "button_pressed") {
              this.handleButtonPressedEvent();
            }
            if (json.event === "button_released") {
              this.handleButtonReleasedEvent();
            }
            if (json.event === "camera_capture") {
              this.handleCameraCaptureEvent();
            }
            if (json.event === "exit_camera_mode") {
              this.display({ camera_mode: false });
            }
          } catch {
            // ignore invalid non-json lines
          }
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
    if (this.buttonDetectInterval) {
      clearTimeout(this.buttonDetectInterval);
      this.buttonDetectInterval = null;
    }
    this.buttonPressTimeArray = [];
    this.buttonReleaseTimeArray = [];
    this.buttonDoubleClickCallback = callback || null;
  }

  onCameraCapture(callback: () => void): void {
    this.onCameraCaptureCallback = callback;
  }

  onTextInput(callback: (text: string) => void): void {
    this.textInputCallback = callback;
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

  private stopTextCounter(): void {
    if (this.textCounterTimer) {
      clearInterval(this.textCounterTimer);
      this.textCounterTimer = null;
    }
    this.textCounterTemplate = null;
    this.textCounterStartAt = 0;
  }

  private startTextCounter(template: string): void {
    this.stopTextCounter();
    this.textCounterTemplate = template;
    this.textCounterStartAt = Date.now();
    this.textCounterTimer = setInterval(() => {
      if (!this.textCounterTemplate) {
        this.stopTextCounter();
        return;
      }
      const elapsedSec = Math.floor((Date.now() - this.textCounterStartAt) / 1000);
      const renderedText = this.textCounterTemplate.replace(
        /\{count\}/g,
        `${elapsedSec}`,
      );
      if (this.currentStatus.text === renderedText) {
        return;
      }
      this.currentStatus.text = renderedText;
      const data = JSON.stringify({ text: renderedText, brightness: 100 });
      this.sendToDisplay(data);
      this.webDisplay?.updateStatus(this.currentStatus);
    }, 1000);
  }

  async display(newStatus: Partial<Status> = {}): Promise<void> {
    const hasTextOverride = Object.prototype.hasOwnProperty.call(
      newStatus,
      "text",
    );
    const normalizedStatus: Partial<Status> = { ...newStatus };
    if (hasTextOverride) {
      const incomingText = `${newStatus.text ?? ""}`;
      if (incomingText.includes("{count}")) {
        this.startTextCounter(incomingText);
        const initialText = incomingText.replace(/\{count\}/g, "0");
        normalizedStatus.text = initialText;
      } else {
        this.stopTextCounter();
      }
    }

    const {
      status,
      emoji,
      text,
      text_input_enabled,
      RGB,
      brightness,
      scroll_sync,
      battery_level,
      battery_color,
      image,
      camera_mode,
      camera_capture,
      capture_image_path,
      network_connected,
      vpn_connected,
      rag_icon_visible,
      image_icon_visible,
      music_progress,
      music_duration_ms,
    } = {
      ...this.currentStatus,
      ...normalizedStatus,
    };

    const changedValues = Object.entries(normalizedStatus).filter(
      ([key, value]) => (this.currentStatus as any)[key] !== value,
    );

    const isTextChanged = changedValues.some(([key]) => key === "text");

    this.currentStatus.status = status;
    this.currentStatus.emoji = emoji;
    this.currentStatus.text = text;
    this.currentStatus.text_input_enabled = text_input_enabled;
    this.currentStatus.RGB = RGB;
    this.currentStatus.brightness = brightness;
    this.currentStatus.scroll_sync = scroll_sync;
    this.currentStatus.battery_level = battery_level;
    this.currentStatus.battery_color = battery_color;
    this.currentStatus.image = image;
    this.currentStatus.camera_mode = camera_mode;
    this.currentStatus.capture_image_path = capture_image_path;
    this.currentStatus.network_connected = network_connected;
    this.currentStatus.vpn_connected = vpn_connected;
    this.currentStatus.rag_icon_visible = rag_icon_visible;
    this.currentStatus.image_icon_visible = image_icon_visible;
    this.currentStatus.music_progress = music_progress;
    this.currentStatus.music_duration_ms = music_duration_ms;
    
    const changedValuesObj = Object.fromEntries(changedValues);
    changedValuesObj.brightness = 100;
    const data = JSON.stringify(changedValuesObj);
    if (isTextChanged) console.log("send data:", data);

    if (normalizedStatus.camera_capture) {
      const capturePath = normalizedStatus.capture_image_path || this.currentStatus.capture_image_path;
      if (capturePath) {
        const webCamEnabled = parseBoolEnv("WEB_CAMERA_ENABLED", false);
        if (webCamEnabled && webAudioBridge.isCameraAvailable()) {
          // Request capture from browser camera regardless of physical device state.
          webAudioBridge
            .requestCameraCapture(capturePath)
            .then(() => this.handleCameraCaptureEvent())
            .catch((e) =>
              console.error("[WebCamera] Capture failed:", e),
            );
        } else if (!this.deviceEnabled) {
          // No physical hardware and no web camera: use the Pi camera daemon.
          this.sendCameraDaemonCommand("capture", { path: capturePath });
          this.handleCameraCaptureEvent();
        }
        // When deviceEnabled=true and no web camera: chatbot-ui.py handles the capture.
      }
    }

    this.sendToDisplay(data);
    this.webDisplay?.updateStatus(this.currentStatus);
  }

  private handleButtonPressedEvent(): void {
    this.buttonDown = true;
    this.buttonPressTimeArray.push(Date.now());
    this.startMonitoringDoubleClick();
    if (!this.buttonDetectInterval) {
      console.log("emit pressed");
      this.buttonPressedCallback();
    }
  }

  private handleButtonReleasedEvent(): void {
    this.buttonDown = false;
    this.buttonReleaseTimeArray.push(Date.now());
    if (!this.buttonDetectInterval) {
      console.log("emit released");
      this.buttonReleasedCallback();
    }
  }

  isButtonDown(): boolean {
    return this.buttonDown;
  }

  private handleCameraCaptureEvent(): void {
    this.onCameraCaptureCallback();
  }

  private handleTextInputEvent(text: string): void {
    this.textInputCallback(text);
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
export const onTextInput =
  displayInstance.onTextInput.bind(displayInstance);
export const isButtonDown =
  displayInstance.isButtonDown.bind(displayInstance);

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
