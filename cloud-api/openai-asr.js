const { OpenAI } = require("openai");
require("dotenv").config();

const openAIAPIKey = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
  apiKey: openAIAPIKey,
});

const recognizeAudio = async (audioPath) => {
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioFilePath),
    model: "whisper-1",
  });
  console.log("识别结果:", transcription.text);
  return transcription.text;
};

module.exports = {
  recognizeAudio,
};
