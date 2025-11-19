import dotenv from "dotenv";

dotenv.config();

// ASR and TTS
export const byteDanceAppId = process.env.VOLCENGINE_APP_ID || "";
export const byteDanceAccessToken = process.env.VOLCENGINE_ACCESS_TOKEN || "";
export const byteDanceVoiceType =
  process.env.VOLCENGINE_VOICE_TYPE || "zh_female_wanwanxiaohe_moon_bigtts";

// Doubao LLM
export const doubaoAccessToken =
  process.env.VOLCENGINE_DOUBAO_ACCESS_TOKEN || "";
export const doubaoLLMModel =
  process.env.VOLCENGINE_DOUBAO_LLM_MODEL || "doubao-1-5-lite-32k-250115"; // Default model
export const enableThinking = process.env.ENABLE_THINKING === "true";

// Vision Model
export const volcengineVisionModel =
  process.env.VOLCENGINE_VISION_MODEL || "doubao-seed-1-6-flash-250828";

// Image Generation
export const doubaoImageModel =
  process.env.VOLCENGINE_DOUBAO_IMAGE_MODEL || "doubao-seedream-3-0-t2i-250415";
