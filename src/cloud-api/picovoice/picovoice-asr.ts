import * as fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const picovoiceAccessKey = process.env.PICOVOICE_ACCESS_KEY || "";
// Optional: path to a custom Leopard model file (.pv)
const leopardModelPath = process.env.PICOVOICE_LEOPARD_MODEL_PATH || undefined;

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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Leopard } = require("@picovoice/leopard-node");
    const leopard = new Leopard(
      picovoiceAccessKey,
      leopardModelPath ? { modelPath: leopardModelPath } : {},
    );

    const { transcript } = leopard.processFile(audioFilePath);
    leopard.release();

    console.log("[Picovoice ASR] Transcript:", transcript);
    return transcript as string;
  } catch (error: any) {
    console.error("[Picovoice ASR] Recognition failed:", error.message);
    return "";
  }
};
