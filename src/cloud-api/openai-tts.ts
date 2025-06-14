import { OpenAI } from "openai";
import mp3Duration from "mp3-duration";
import dotenv from "dotenv";

dotenv.config();

const openAIAPIKey = process.env.OPENAI_API_KEY;

const openai = openAIAPIKey
  ? new OpenAI({
      apiKey: openAIAPIKey,
    })
  : null;

const openaiTTS = async (
  text: string
): Promise<{ data: Buffer, duration: number }> => {
  if (!openai) {
    console.error("OpenAI API key is not set.");
    return { data: Buffer.from([]), duration: 0 };
  }
  const mp3 = await openai.audio.speech.create({
    model: "tts-1",
    voice: "nova", // Optional: alloy, echo, fable, onyx, nova, shimmer
    input: text,
  });
  const buffer = Buffer.from(await mp3.arrayBuffer());
  const duration = await mp3Duration(buffer);
  return { data: buffer, duration: duration * 1000 };
};

export default openaiTTS;
