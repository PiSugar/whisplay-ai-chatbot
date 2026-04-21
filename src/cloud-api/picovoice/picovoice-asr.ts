import * as fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const picovoiceAccessKey = process.env.PICOVOICE_ACCESS_KEY || "";
// Optional: path to a custom Leopard model file (.pv)
const leopardModelPath = process.env.PICOVOICE_LEOPARD_MODEL_PATH || undefined;

// Lazy singleton — initialised on first use, then reused across calls
let leopardInstance: any = null;

function getLeopard(): any {
  if (!leopardInstance) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Leopard } = require("@picovoice/leopard-node");
    leopardInstance = new Leopard(
      picovoiceAccessKey,
      leopardModelPath ? { modelPath: leopardModelPath } : {},
    );
    console.log("[Picovoice ASR] Leopard instance initialized.");
  }
  return leopardInstance;
}

export const recognizeAudio = async (
  audioFilePath: string,
): Promise<string> => {
  if (!picovoiceAccessKey) {
    console.error("[Picovoice ASR] PICOVOICE_ACCESS_KEY is not set.");
    return "";
  }
  if (!fs.existsSync(audioFilePath)) {
    console.error("[Picovoice ASR] Audio file does not exist:", audioFilePath);
    return "";
  }

  try {
    const leopard = getLeopard();
    const { transcript } = leopard.processFile(audioFilePath);

    console.log("[Picovoice ASR] Transcript:", transcript);
    return transcript as string;
  } catch (error: any) {
    console.error("[Picovoice ASR] Recognition failed:", error.message);
    // Reset instance on error so it can be re-initialized on next call
    leopardInstance = null;
    return "";
  }
};
