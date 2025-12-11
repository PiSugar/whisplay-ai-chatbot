import path from "path";
import getAudioDurationInSeconds from "get-audio-duration";
import { savePcmAsWav } from "../../utils";
import { ttsDir } from "../../utils/dir";
import {
  geminiTTSSpeaker,
  geminiTTSModel,
  geminiTTSLanguageCode,
  gemini,
} from "./gemini";
import dotenv from "dotenv";
import { TTSResult } from "../../type";

dotenv.config();

const geminiTTS = async (
  text: string
): Promise<TTSResult> => {
  try {
    if (!gemini) {
      console.error("Google Gemini API key is not set.");
      return { duration: 0 };
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
    }).catch(err => {
      console.log("Gemini TTS request failed:", err);
      return null;
    });

    const audioData =
      response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!audioData) {
      console.error("No audio content received from Gemini TTS");
      return { duration: 0 };
    }

    const buffer = Buffer.from(audioData, "base64");

    // save file to ttsDir
    const filePath = path.join(ttsDir, `gemini_tts_${Date.now()}.wav`);
    savePcmAsWav(buffer, filePath, 24000, 1);

    return {
      filePath,
      duration: await getAudioDurationInSeconds(filePath) * 1000, // add 800ms buffer to avoid cut-off
    };
  } catch (error) {
    console.error("Gemini TTS error:", error);
    return { duration: 0 };
  }
};

export default geminiTTS;
