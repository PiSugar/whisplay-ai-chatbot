import { geminiTTSSpeaker, geminiTTSModel, GEMINI_API_KEY, geminiTTSLanguageCode } from "./gemini";
import mp3Duration from "mp3-duration";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const url = `https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${GEMINI_API_KEY}`;

const geminiTTS = async (
  text: string
): Promise<{ data: Buffer; duration: number }> => {
  try {
    const request = {
      input: { text },
      voice: {
        languageCode: geminiTTSLanguageCode, // e.g., "en-US"
        name: geminiTTSSpeaker, // Gemini TTS voice
        modelName: geminiTTSModel, // Gemini TTS model
      },
      audioConfig: {
        audioEncoding: "MP3" as const,
      },
    };

    const response = await axios.post<
      any,
      {
        audioContent: string;
      }
    >(url, request);

    if (!response.audioContent) {
      console.error("No audio content received from Gemini TTS");
      return { data: Buffer.from([]), duration: 0 };
    }

    const buffer = Buffer.from(response.audioContent);
    const duration = await mp3Duration(buffer);
    return { data: buffer, duration: duration * 1000 };
  } catch (error) {
    console.error("Gemini TTS error:", error);
    return { data: Buffer.from([]), duration: 0 };
  }
};

export default geminiTTS;
