import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { undiciProxyFetch } from "./proxy-fetch";


dotenv.config();

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
export const geminiTTSModel = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
export const geminiTTSSpeaker = process.env.GEMINI_TTS_SPEAKER || "Callirrhoe";
export const geminiTTSLanguageCode = process.env.GEMINI_TTS_LANGUAGE_CODE || "en-US";

export const gemini = GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
      fetch: undiciProxyFetch as any,
    })
  : null;
