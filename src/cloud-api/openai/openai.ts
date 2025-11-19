import { OpenAI, ClientOptions } from "openai";
import { proxyFetch } from "../proxy-fetch";
import dotenv from "dotenv";

dotenv.config();

const openAiAPIKey = process.env.OPENAI_API_KEY;
const openAiBaseURL = process.env.OPENAI_API_BASE_URL;
// OpenAI LLM
export const openaiLLMModel = process.env.OPENAI_LLM_MODEL || "gpt-4o"; // Default model
export const openaiVisionModel =
  process.env.OPENAI_VISION_MODEL || process.env.OPENAI_LLM_MODEL || "gpt-4o";

// OpenAI Image Generation
export const openaiImageModel = process.env.OPENAI_IMAGE_MODEL || "dall-e-3";

const openAiOptions: ClientOptions = {
  apiKey: openAiAPIKey,
  fetch: proxyFetch as any,
};

if (openAiBaseURL) {
  Object.assign(openAiOptions, { baseURL: openAiBaseURL });
}

export const openai = openAiAPIKey ? new OpenAI(openAiOptions) : null;
