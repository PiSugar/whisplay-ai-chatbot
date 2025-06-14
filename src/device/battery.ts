import { connect, Socket } from "net";
import { EventEmitter } from "events";

class PiSugarBattery extends EventEmitter {
  private client: Socket | null = null;
  private batteryLevel: number = 0;
  private connected: boolean = false;
  private interval: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client = connect(8423, "0.0.0.0", () => {
        console.log("Connected to battery service");
        this.connected = true;
        this.interval = setInterval(() => {
          if (this.connected && this.client) {
            this.client.write("get battery\n");
          }
        }, 5000);
        resolve();
      });

      this.client.on("data", (data: Buffer) => {
        const message = data.toString();
        if (message.startsWith("battery:")) {
          const level = parseInt(message.split(":")[1], 10);
          this.batteryLevel = level;
          this.emit("batteryLevel", level);
        }
      });

      this.client.on("error", (err: Error) => {
        console.error("Battery service error:", err);
        this.connected = false;
        if (this.interval) clearInterval(this.interval);
        reject(err);
      });

      this.client.on("end", () => {
        console.log("Disconnected from battery service");
        this.connected = false;
        if (this.interval) clearInterval(this.interval);
      });
    });
  }

  disconnect(): void {
    if (this.client) {
      this.client.end();
      this.connected = false;
    }
  }

  getBatteryLevel(): number {
    return this.batteryLevel;
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export default PiSugarBattery;
