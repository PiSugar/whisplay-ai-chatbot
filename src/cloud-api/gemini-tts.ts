import { getPcmWavDurationMs } from "../utils";
import {
  geminiTTSSpeaker,
  geminiTTSModel,
  geminiTTSLanguageCode,
  gemini,
} from "./gemini";
import dotenv from "dotenv";

dotenv.config();

const geminiTTS = async (
  text: string
): Promise<{ data: Buffer; duration: number; }> => {
  try {
    if (!gemini) {
      console.error("Google Gemini API key is not set.");
      return { data: Buffer.from([]), duration: 0 };
    }

    const response = await gemini.models.generateContent({
      model: geminiTTSModel,
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: geminiTTSSpeaker },
          },
          languageCode: geminiTTSLanguageCode,
        },
      },
    });

    const audioData =
      response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!audioData) {
      console.error("No audio content received from Gemini TTS");
      return { data: Buffer.from([]), duration: 0 };
    }

    const buffer = Buffer.from(audioData, "base64");

    return {
      data: buffer,
      duration: getPcmWavDurationMs(buffer, {
        channels: 1,
        sampleRate: 16000,
        sampleWidth: 2,
      }),
    };
  } catch (error) {
    console.error("Gemini TTS error:", error);
    return { data: Buffer.from([]), duration: 0 };
  }
};

export default geminiTTS;
