const { chatWithDoubaoStream } = require("./cloud-api/doubao-llm");
const volcengineTTS = require("./cloud-api/volcengine-tts");
const openaiTTS = require("./cloud-api/openai-tts");
const { chatWithOpenAI } = require("./cloud-api/openai-llm");
const { recognizeAudio } = require("./cloud-api/openai-asr");
const { createSteamResponser, playAudioData } = require("./device/audio");

const { partial, endPartial, getPlayEndPromise } = createSteamResponser(
  volcengineTTS,
  (text) => {
    console.log("完整回复 outside:", text);
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
      const resonse = await chatWithOpenAI(text);
      if (resonse) {
        const result = await openaiTTS(resonse);
        console.log("合成结果:", result);
        await playAudioData(result.data, result.duration);
      }
    } else {
      console.log("识别结果为空, 请继续说");
      display({ status: "请继续说" });
    }
  }
})();
