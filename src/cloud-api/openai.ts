import { OpenAI } from "openai";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const openAiAPIKey = process.env.OPENAI_API_KEY;
const openAiBaseURL = process.env.OPENAI_API_BASE_URL;

const openAiOptions = {
  apiKey: openAiAPIKey,
}

if (openAiBaseURL) {
  Object.assign(openAiOptions, { baseURL: openAiBaseURL });
}

export const openai = openAiAPIKey
  ? new OpenAI(openAiOptions)
  : null;
