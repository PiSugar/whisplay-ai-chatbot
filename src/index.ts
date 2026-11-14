import ChatFlow from "./core/ChatFlow";
import dotenv from "dotenv";
import { startBatteryStatus } from "./status/battery-status";
import { startWifiStatus } from "./status/wifi-status";
import { startVpnStatus } from "./status/vpn-status";
import { registerShutdownHandler } from "./device/display";

dotenv.config();

startBatteryStatus();
startWifiStatus();
startVpnStatus();

const chatFlow = new ChatFlow({
  enableCamera: process.env.ENABLE_CAMERA === "true",
});

registerShutdownHandler(() => chatFlow.shutdown());
