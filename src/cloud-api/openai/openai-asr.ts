import fs from "fs";
import { openai } from "./openai"; // Assuming openai is exported from openai.ts

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
      model: "whisper-1",
    });
    console.log("Transcription result:", transcription.text);
    return transcription.text;
  } catch (error) {
    console.error("Audio recognition failed:", error);
    return "";
  }
};
