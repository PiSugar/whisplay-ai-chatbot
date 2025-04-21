const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");
const mp3Duration = require("mp3-duration");
require("dotenv").config();

const openAIAPIKey = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
  apiKey: openAIAPIKey,
});

const openaiTTS = async (text) => {
  const mp3 = await openai.audio.speech.create({
    model: "tts-1",
    voice: "nova", // 可选：alloy, echo, fable, onyx, nova, shimmer
    input: text,
  });
  const buffer = Buffer.from(await mp3.arrayBuffer());
  const duration = await mp3Duration(buffer);
  //
  return { data: buffer, duration: duration * 1000 };
};

module.exports = openaiTTS;
