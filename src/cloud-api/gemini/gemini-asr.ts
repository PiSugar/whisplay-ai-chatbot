import fs from "fs";
import { gemini, geminiModel } from "./gemini";

export const recognizeAudio = async (
  audioFilePath: string
): Promise<string> => {
  if (!gemini) {
    console.error("Gemini API key is not set.");
    return "";
  }
  if (!fs.existsSync(audioFilePath)) {
    console.error("Audio file does not exist:", audioFilePath);
    return "";
  }

  try {
    // Read audio file as base64
    const audioBase64 = fs.readFileSync(audioFilePath, {
      encoding: "base64",
    });

    // Get file extension to determine MIME type
    const fileExtension = audioFilePath.split(".").pop()?.toLowerCase();
    const mimeType = getMimeType(fileExtension);

    const contents = [
      { text: "Generate a transcript of the speech. Do not include noise, silence, or any non-speech sounds. Only write the words that are actually spoken." },
      {
        inlineData: {
          mimeType: mimeType,
          data: audioBase64,
        },
      },
    ];

    const response = await gemini.models.generateContent({
      model: geminiModel,
      contents: contents,
    });

    const transcription = response.text || "";
    return transcription;
  } catch (error) {
    console.error("Audio recognition failed:", error);
    return "";
  }
};

function getMimeType(extension: string | undefined): string {
  switch (extension) {
    case "mp3":
      return "audio/mp3";
    case "wav":
      return "audio/wav";
    case "m4a":
      return "audio/m4a";
    case "flac":
      return "audio/flac";
    default:
      return "audio/wav";
  }
}
