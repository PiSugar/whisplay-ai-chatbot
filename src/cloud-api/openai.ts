import { OpenAI } from "openai";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const openAiAPIKey = process.env.OPENAI_API_KEY;
const openAiBaseURL = process.env.OPENAI_API_BASE_URL;

export const openai = openAiAPIKey
  ? new OpenAI({
      apiKey: openAiAPIKey,
      baseURL: openAiBaseURL || "https://api.openai.com/v2",
    })
  : null;
