import * as fs from "fs";

const path = "/sys/kernel/debug/gpio";
const data = fs.readFileSync(path, "utf8");

function convertPin(gpioPin: number): number {
  const lines = data.split("\n");
  for (const line of lines) {
    if (line.includes(`GPIO${gpioPin} `)) {
      const parts = line.split(" ");
      const pin = parts.find((part) => part.startsWith("gpio-"));
      if (pin) {
        return parseInt(pin.replace("gpio-", ""), 10);
      }
    }
  }
  return gpioPin;
}

export { convertPin };
