const volcengineTTS = require("../cloud-api/volcengine-tts");
const openaiTTS = require("../cloud-api/openai-tts");
const { chatWithLLM, chatWithLLMStream } = require("../cloud-api/openai-llm");
const { recognizeAudio } = require("../cloud-api/openai-asr");
const {
  recordAudio,
  playAudioData,
  createSteamResponser,
} = require("../device/audio");

const { display } = require("../device/display");
const { extractEmojis } = require("../utils");

const { partial, endPartial, getPlayEndPromise } = createSteamResponser(
  volcengineTTS,
  (sentences) => {
    const fullText = sentences.join("");
    display({
      status: "回答中",
      text: fullText,
      emoji: extractEmojis(fullText),
    });
  },
  (text) => {
    console.log("完整回答:", text);
  }
);

// main
(async () => {
  display();
  const filePath = "record.mp3";

  while (true) {
    console.log("聆听中...");
    display({ status: "正在聆听", emoji: "😐", text: "" });
    await recordAudio(filePath, 60);
    display({ status: "识别中", emoji: "🤔", text: "" });
    const text = await recognizeAudio(filePath);
    // const text = await volcengineASR(filePath);
    // 调用字节跳动语音合成，播报识别结果
    display({ text });
    if (text) {
      await Promise.all([
        chatWithLLMStream([{
          role: "user",
          content: text,
        }], partial, endPartial),
        getPlayEndPromise(),
      ]);
    } else {
      console.log("识别结果为空, 请继续说");
      display({ status: "请继续说" });
    }
  }
})();
