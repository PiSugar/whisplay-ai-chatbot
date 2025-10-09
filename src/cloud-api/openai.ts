import { OpenAI, ClientOptions } from "openai";
import { proxyFetch } from "./proxy-fetch";
import dotenv from "dotenv";

dotenv.config();

const openAiAPIKey = process.env.OPENAI_API_KEY;
const openAiBaseURL = process.env.OPENAI_API_BASE_URL;

const openAiOptions: ClientOptions = {
  apiKey: openAiAPIKey,
  fetch: proxyFetch as any,
};

if (openAiBaseURL) {
  Object.assign(openAiOptions, { baseURL: openAiBaseURL });
}

export const openai = openAiAPIKey ? new OpenAI(openAiOptions) : null;
