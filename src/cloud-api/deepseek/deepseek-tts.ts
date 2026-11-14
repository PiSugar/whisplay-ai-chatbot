import { TTSResult } from "../../type";
import { proxyFetch } from "../proxy-fetch";
import {
  deepseekApiKey,
  deepseekEndpoint,
  deepseekHeaders,
  describeDeepseekHttpError,
} from "./deepseek";

const voiceId = process.env.DEEPSEEK_TTS_VOICE || "stella";

const getWavDurationMs = (buffer: Buffer): number => {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") {
    return 0;
  }
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === "fmt " && offset + 20 <= buffer.length) {
      byteRate = buffer.readUInt32LE(offset + 16);
    } else if (chunkId === "data") {
      dataSize = Math.min(chunkSize, buffer.length - offset - 8);
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return byteRate > 0 ? Math.ceil((dataSize / byteRate) * 1000) : 0;
};

const deepseekTTS = async (text: string): Promise<TTSResult> => {
  if (!deepseekApiKey) {
    console.error("[DeepSeek TTS] DEEPSEEK_API_KEY is not set.");
    return { duration: 0 };
  }
  try {
    const response = await proxyFetch(deepseekEndpoint("v1/tools/tts"), {
      method: "POST",
      headers: {
        ...deepseekHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice_id: voiceId,
        format: "wav",
        filter_markdown: true,
      }),
    });
    if (!response.ok) {
      throw new Error(await describeDeepseekHttpError(response));
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const duration = getWavDurationMs(buffer);
    if (!duration) {
      throw new Error("DeepSeek returned an invalid or incomplete WAV stream.");
    }
    return { buffer, duration };
  } catch (error: any) {
    console.error("[DeepSeek TTS] Synthesis failed:", error.message);
    return { duration: 0 };
  }
};

export default deepseekTTS;
