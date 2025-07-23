import { exec } from "child_process";
import { resolve } from "path";
import { Socket } from "net";

interface Status {
  status: string;
  emoji: string;
  text: string;
  scroll_speed: number;
  brightness: number;
  RGB: string;
  battery_color: string;
  battery_level: number;
}

export class WhisplayDisplay {
  private currentStatus: Status = {
    status: "starting",
    emoji: "😊",
    text: "",
    scroll_speed: 3,
    brightness: 100,
    RGB: "#00FF30",
    battery_color: "#000000",
    battery_level: 100, // 0-100
  };

  private client = new Socket();
  private buttonPressedCallback: () => void = () => {};
  private buttonReleasedCallback: () => void = () => {};
  private isReady: Promise<void>;
  private pythonProcess: any; // Placeholder for Python process if needed

  constructor() {
    this.startPythonProcess();
    this.isReady = new Promise<void>((resolve) => {
      this.connectWithRetry(10, resolve);
    });
  }

  startPythonProcess(): void {
    const command = `cd ${resolve(
      __dirname,
      "../../python"
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
      console.log(data.toString())
    );
    this.pythonProcess.stderr.on("data", (data: any) =>
      console.error(data.toString())
    );
  }

  killPythonProcess(): void {
    if (this.pythonProcess) {
      console.log("Killing Python process...");
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
  }

  async connectWithRetry(
    retries: number = 6,
    outerResolve: () => void
  ): Promise<void> {
    await new Promise((resolve, reject) => {
      const attemptConnection = (attempt: number) => {
        this.connect(resolve).catch((err) => {
          if (attempt < retries) {
            console.log(`Connection attempt ${attempt} failed, retrying...`);
            setTimeout(() => attemptConnection(attempt + 1), 10000);
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

  async connect(resolve: (value: any) => void): Promise<void> {
    console.log("Connecting to local display socket...");
    this.client.connect(12345, "0.0.0.0", () => {
      console.log("Connected to local display socket");
      this.sendToDisplay(JSON.stringify(this.currentStatus));
      this.client.on("data", (data: Buffer) => {
        const dataString = data.toString();
        console.log("Received data from EchoView hat:", dataString);
        if (dataString.trim() === "OK") {
          return;
        }
        try {
          const json = JSON.parse(dataString);
          if (json.event === "button_pressed") {
            this.buttonPressedCallback();
          }
          if (json.event === "button_released") {
            this.buttonReleasedCallback();
          }
        } catch {
          console.error("Failed to parse JSON from data");
        }
      });
      this.client.on("error", (err: Error) => {
        console.error("Socket error:", err);
      });
      resolve(true);
    });
  }

  onButtonPressed(callback: () => void): void {
    this.buttonPressedCallback = callback;
  }

  onButtonReleased(callback: () => void): void {
    this.buttonReleasedCallback = callback;
  }

  private async sendToDisplay(data: string): Promise<void> {
    await this.isReady;
    try {
      this.client.write(`${data}\n`, "utf8", () => {
        // console.log("send", data);
      });
    } catch (error) {
      console.error("Failed to update display.");
    }
  }

  async display(newStatus: Partial<Status> = {}): Promise<void> {
    const {
      status,
      emoji,
      text,
      RGB,
      brightness,
      battery_level,
      battery_color,
    } = {
      ...this.currentStatus,
      ...newStatus,
    };

    const changedValues = Object.entries(newStatus).filter(
      ([key, value]) => (this.currentStatus as any)[key] !== value
    );

    const isTextChanged = changedValues.some(([key]) => key === "text");

    this.currentStatus.status = status;
    this.currentStatus.emoji = emoji;
    this.currentStatus.text = text;
    this.currentStatus.RGB = RGB;
    this.currentStatus.brightness = brightness;
    this.currentStatus.battery_level = battery_level;
    this.currentStatus.battery_color = battery_color;

    const changedValuesObj = Object.fromEntries(changedValues);
    changedValuesObj.brightness = 100;
    const data = JSON.stringify(changedValuesObj);
    if (isTextChanged) console.log("send data:", data);
    this.sendToDisplay(data);
  }
}

// Create a singleton instance to maintain backward compatibility
const displayInstance = new WhisplayDisplay();

export const display = displayInstance.display.bind(displayInstance);
export const onButtonPressed =
  displayInstance.onButtonPressed.bind(displayInstance);
export const onButtonReleased =
  displayInstance.onButtonReleased.bind(displayInstance);


// kill the Python process on exit signals
process.on("SIGINT", () => {
  console.log("SIGINT received, killing Python process...");
  displayInstance.killPythonProcess();
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("SIGTERM received, killing Python process...");
  displayInstance.killPythonProcess();
  process.exit(0);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  displayInstance.killPythonProcess();
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  displayInstance.killPythonProcess();
});
