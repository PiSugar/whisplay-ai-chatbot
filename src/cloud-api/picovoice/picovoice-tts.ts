import * as path from "path";
import { getAudioDurationInSeconds } from "get-audio-duration";
import dotenv from "dotenv";
import { ttsDir } from "../../utils/dir";
import { TTSResult } from "../../type";

dotenv.config();

const picovoiceAccessKey = process.env.PICOVOICE_ACCESS_KEY || "";
// Optional: path to a custom Orca model file (.pv)
const orcaModelPath = process.env.PICOVOICE_ORCA_MODEL_PATH || undefined;

const picovoiceTTS = async (text: string): Promise<TTSResult> => {
  if (!picovoiceAccessKey) {
    console.error("[Picovoice TTS] PICOVOICE_ACCESS_KEY is not set.");
    return { duration: 0 };
  }
  if (!text.trim()) {
    return { duration: 0 };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Orca } = require("@picovoice/orca-node");
    const orca = new Orca(
      picovoiceAccessKey,
      orcaModelPath ? { modelPath: orcaModelPath } : {},
    );

    const outputPath = path.join(ttsDir, `picovoice_tts_${Date.now()}.wav`);
    orca.synthesizeToFile(text, outputPath);
    orca.release();

    const durationSec = await getAudioDurationInSeconds(outputPath).catch(
      () => 0,
    );
    const duration = durationSec * 1000;

    console.log(
      `[Picovoice TTS] Synthesized "${text.slice(0, 40)}..." → ${outputPath}`,
    );
    return { filePath: outputPath, duration };
  } catch (error: any) {
    console.error("[Picovoice TTS] Synthesis failed:", error.message);
    return { duration: 0 };
  }
};

export default picovoiceTTS;
