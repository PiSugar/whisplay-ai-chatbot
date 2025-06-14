const { chatWithLLMStream } = require("../cloud-api/volcengine-llm");
const volcengineTTS = require("../cloud-api/volcengine-tts");
const openaiTTS = require("../cloud-api/openai-tts");
const { createSteamResponser, playAudioData } = require("../device/audio");

const { partial, endPartial, getPlayEndPromise } = createSteamResponser(
  volcengineTTS,
  (text) => {
    console.log("完整回复 outside:", text);
  }
);

// main
(async () => {
  const text = "你好，可以给我介绍一下广州有哪些好吃的吗？";

  const result = await openaiTTS(text);
  console.log("合成结果:", result);
  await playAudioData(result.data, result.duration);

  console.log("播放结束");
})();
