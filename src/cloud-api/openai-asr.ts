import { OpenAI } from "openai";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const openAIAPIKey = process.env.OPENAI_API_KEY;

const openai = openAIAPIKey
  ? new OpenAI({
      apiKey: openAIAPIKey,
    })
  : null;

export const recognizeAudio = async (
  audioFilePath: string
): Promise<string> => {
  if (!openai) {
    console.error("OpenAI API key is not set.");
    return "";
  }
  if (!fs.existsSync(audioFilePath)) {
    console.error("音频文件不存在:", audioFilePath);
    return "";
  }

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath),
      model: "whisper-1",
    });
    console.log("识别结果:", transcription.text);
    return transcription.text;
  } catch (error) {
    console.error("音频识别失败:", error);
    return "";
  }
};
