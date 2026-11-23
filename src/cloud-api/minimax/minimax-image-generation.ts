import axios from "axios";
import { randomUUID } from "crypto";
import { writeFile } from "fs/promises";
import path from "path";
import type { PluginContext } from "../../plugin/types";
import { LLMTool, ToolReturnTag } from "../../type";
import { setLatestGenImg } from "../../utils/image";

interface GenerationResponse {
  data?: { b64_json?: string; error?: { message?: string } }[];
  error?: { message?: string };
}

export function createMiniMaxImageTool({ env, imageDir }: PluginContext): LLMTool {
  return {
    type: "function",
    function: {
      name: "generateImage",
      description: "Generate an image from a text prompt",
      parameters: {
        type: "object",
        properties: { prompt: { type: "string", description: "Image description" } },
        required: ["prompt"],
      },
    },
    func: async ({ prompt, withImageContext }) => {
      if (withImageContext) return `${ToolReturnTag.Error}MiniMax H3 requires a text-only prompt.`;
      if (!env.MINIMAX_API_KEY) return `${ToolReturnTag.Error}Set MINIMAX_API_KEY to generate images.`;
      const region = env.MINIMAX_IMAGE_REGION || "global";
      if (region !== "global" && region !== "cn") {
        return `${ToolReturnTag.Error}MINIMAX_IMAGE_REGION must be global or cn.`;
      }
      const host = region === "cn" ? "api.minimax.cn" : "api.minimax.io";
      try {
        const response = await axios.post<GenerationResponse>(
          `https://${host}/v1/images/generations`,
          {
            model: env.MINIMAX_IMAGE_MODEL || "MiniMax-H3-Image",
            prompt,
            n: 1,
            response_format: "b64_json",
            output_format: "jpeg",
          },
          {
            headers: { Authorization: `Bearer ${env.MINIMAX_API_KEY}` },
            timeout: 600_000,
            maxRedirects: 0,
          },
        );
        const item = response.data.data?.[0];
        if (item?.error || !item?.b64_json) {
          return `${ToolReturnTag.Error}${item?.error?.message || "No image was generated."}`;
        }
        const file = path.join(imageDir, `minimax-image-${randomUUID()}.jpg`);
        await writeFile(file, Buffer.from(item.b64_json, "base64"));
        setLatestGenImg(file);
        return `${ToolReturnTag.Success}Image file saved.`;
      } catch (error) {
        if (axios.isAxiosError<GenerationResponse>(error) && error.response) {
          const detail = error.response.data?.error?.message || `HTTP ${error.response.status}`;
          return `${ToolReturnTag.Error}Image generation failed: ${detail}`;
        }
        return `${ToolReturnTag.Error}Image generation failed.`;
      }
    },
  };
}
