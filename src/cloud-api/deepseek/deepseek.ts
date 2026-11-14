import { ClientOptions, OpenAI } from "openai";
import { proxyFetch } from "../proxy-fetch";

export const deepseekApiKey = process.env.DEEPSEEK_API_KEY || "";
export const deepseekBaseUrl = (
  process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com"
).replace(/\/+$/, "");
export const deepseekLLMModel =
  process.env.DEEPSEEK_LLM_MODEL || "deepseek-flash";
export const deepseekVisionModel =
  process.env.DEEPSEEK_VISION_MODEL || "deepseek-flash";

const options: ClientOptions = {
  apiKey: deepseekApiKey,
  baseURL: deepseekBaseUrl,
  fetch: proxyFetch as any,
};

export const deepseek = deepseekApiKey ? new OpenAI(options) : null;

export const deepseekEndpoint = (path: string): string =>
  `${deepseekBaseUrl}/${path.replace(/^\/+/, "")}`;

export const deepseekHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${deepseekApiKey}`,
});

export const describeDeepseekHttpError = async (
  response: Response,
): Promise<string> => {
  const body = await response.text().catch(() => "");
  let detail = body;
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message || parsed?.message || body;
  } catch {
    // Keep the raw response body when it is not JSON.
  }
  return `HTTP ${response.status}${detail ? `: ${detail}` : ""}`;
};
