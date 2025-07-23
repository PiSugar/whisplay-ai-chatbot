import { exec } from "child_process";
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
    this.isReady = new Promise<void>((resolve) => {
      this.connect(resolve);
    });
  }

  startPythonProcess(): void {
    console.log("Starting Python process...");
    this.pythonProcess = exec(
      `cd ${__dirname}/../python && python3 chatbot-ui.py`,
      (error, stdout, stderr) => {
        if (error) {
          console.error("Error starting Python process:", error);
          return;
        }
      }
    );
  }

  killPythonProcess(): void {
    if (this.pythonProcess) {
      console.log("Killing Python process...");
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
  }

  async connect(resolve: () => void): Promise<void> {
    if (this.pythonProcess) {
      this.pythonProcess.kill();
    }
    this.startPythonProcess();
    await new Promise((res) => setTimeout(res, 10000)); // Wait for Python process to start
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
      resolve();
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
