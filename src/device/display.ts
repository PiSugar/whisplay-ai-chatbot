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

const currentStatus: Status = {
  status: "starting",
  emoji: "😊",
  text: "",
  scroll_speed: 3,
  brightness: 100,
  RGB: "#00FF30",
  battery_color: "#000000",
  battery_level: 100, // 0-100
};

let buttonPressedCallback: () => void = () => {};
let buttonReleasedCallback: () => void = () => {};

const client = new Socket();

const isReady = new Promise<void>((resolve) => {
  client.connect(12345, "0.0.0.0", () => {
    console.log("Connected to local display socket");
    sendToDisplay(JSON.stringify(currentStatus));
    client.on("data", (data: Buffer) => {
      const dataString = data.toString();
      console.log("Received data from EchoView hat:", dataString);
      if (dataString.trim() === "OK") {
        return;
      }
      try {
        const json = JSON.parse(dataString);
        if (json.event === "button_pressed") {
          buttonPressedCallback();
        }
        if (json.event === "button_released") {
          buttonReleasedCallback();
        }
      } catch {
        console.error("Failed to parse JSON from data");
      }
    });
    client.on("error", (err: Error) => {
      console.error("Socket error:", err);
    });
    resolve();
  });
});

const onButtonPressed = (callback: () => void): void => {
  buttonPressedCallback = callback;
};

const onButtonReleased = (callback: () => void): void => {
  buttonReleasedCallback = callback;
};

const sendToDisplay = async (data: string): Promise<void> => {
  await isReady;
  try {
    client.write(`${data}\n`, "utf8", () => {
      // console.log("send", data);
    });
  } catch (error) {
    console.error("Failed to update display.");
  }
};

async function display(newStatus: Partial<Status> = {}): Promise<void> {
  const { status, emoji, text, RGB, brightness, battery_level, battery_color } =
    {
      ...currentStatus,
      ...newStatus,
    };

  const changedValues = Object.entries(newStatus).filter(
    ([key, value]) => (currentStatus as any)[key] !== value
  );

  const isTextChanged = changedValues.some(([key]) => key === "text");

  currentStatus.status = status;
  currentStatus.emoji = emoji;
  currentStatus.text = text;
  currentStatus.RGB = RGB;
  currentStatus.brightness = brightness;
  currentStatus.battery_level = battery_level;
  currentStatus.battery_color = battery_color;

  const changedValuesObj = Object.fromEntries(changedValues);
  changedValuesObj.brightness = 100;
  const data = JSON.stringify(changedValuesObj);
  if (isTextChanged) console.log("send data:", data);
  sendToDisplay(data);
}

function extractEmojis(str: string): string {
  const array = [
    ...str.matchAll(/([\p{Emoji_Presentation}\u200d\ufe0f])/gu),
  ].map((match) => match[0]);

  if (array.length > 0) {
    return array[0];
  }
  return "😐";
}

const flashLED = (color: string, duration: number): (() => void) => {
  const int = setInterval(() => {
    display({
      RGB: color,
    });
    setTimeout(() => {
      display({
        RGB: "#000000",
      });
    }, duration / 2);
  }, duration);
  return () => {
    clearInterval(int);
  };
};

export { display, extractEmojis, onButtonPressed, onButtonReleased, flashLED };
