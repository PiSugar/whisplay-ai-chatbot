import fs from "fs";
import path from "path";
import { proxyFetch } from "../proxy-fetch";
import {
  deepseekApiKey,
  deepseekEndpoint,
  deepseekHeaders,
  describeDeepseekHttpError,
} from "./deepseek";

export const recognizeAudio = async (audioPath: string): Promise<string> => {
  if (!deepseekApiKey) {
    console.error("[DeepSeek ASR] DEEPSEEK_API_KEY is not set.");
    return "";
  }
  if (!fs.existsSync(audioPath)) {
    console.error("[DeepSeek ASR] Audio file does not exist:", audioPath);
    return "";
  }

  try {
    const form = new FormData();
    form.append(
      "file",
      new Blob([fs.readFileSync(audioPath)], { type: "audio/wav" }),
      path.basename(audioPath),
    );
    const response = await proxyFetch(deepseekEndpoint("v1/tools/asr"), {
      method: "POST",
      headers: deepseekHeaders(),
      body: form,
    });
    if (!response.ok) {
      throw new Error(await describeDeepseekHttpError(response));
    }
    const result = (await response.json()) as {
      text?: string;
      duration_ms?: number;
    };
    console.log(
      `[DeepSeek ASR] recognized duration_ms=${result.duration_ms || 0}`,
    );
    return result.text || "";
  } catch (error: any) {
    console.error("[DeepSeek ASR] Recognition failed:", error.message);
    return "";
  }
};
