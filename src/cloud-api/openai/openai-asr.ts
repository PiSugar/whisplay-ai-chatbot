import fs from "fs";
import dotenv from "dotenv";
import { openai } from "./openai"; // Assuming openai is exported from openai.ts

dotenv.config();

const OpenAiAsrModel = process.env.OPENAI_ASR_MODEL || "whisper-1"; //default to whisper-1 - changeable if openai compatible provider like NanoGPT is used

export const recognizeAudio = async (
  audioFilePath: string
): Promise<string> => {
  if (!openai) {
    console.error("OpenAI API key is not set.");
    return "";
  }
  if (!fs.existsSync(audioFilePath)) {
    console.error("Audio file does not exist:", audioFilePath);
    return "";
  }

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath),
      model: OpenAiAsrModel,
    });
    console.log("Transcription result:", transcription.text);
    return transcription.text;
  } catch (error) {
    console.error("Audio recognition failed:", error);
    return "";
  }
};
