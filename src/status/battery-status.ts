import { display } from "../device/display";
import Battery from "../device/battery";

/**
 * Connect to the battery service and forward level changes to the display
 * (with a colour that reflects how full the battery is).
 */
export function startBatteryStatus(): Battery {
  const battery = new Battery();
  battery.connect().catch(() => {
    console.log("Failed to reconnect to battery service.");
  });
  battery.addListener("batteryLevel", (data: number) => {
    let color = "#34d351";
    if (data <= 30) {
      color = "#ff7700";
    }
    if (data <= 10) {
      color = "#ff0000";
    }
    display({
      battery_level: data,
      battery_color: color,
    });
  });
  return battery;
}
