const { chatWithDoubaoStream } = require("./cloud-api/doubao-llm");
const volcengineTTS = require("./cloud-api/volcengine-tts");
const { recognizeAudio } = require("./cloud-api/tencent-cloud");
const { display, extractEmojis } = require("./display");
const { recordAudio, createSteamResponser } = require("./device/audio");

const { partial, endPartial, getPlayEndPromise } = createSteamResponser(
  volcengineTTS,
  (text) => {
    console.log("完整回答:", text);
    display({ text, emoji: extractEmojis(text) });
  }
);

(async () => {
  display();
  const filePath = "record.mp3";

  while (true) {
    console.log("聆听中...");
    display({ status: "聆听中", emoji: "😐", text: "" });
    await recordAudio(filePath, 60);
    display({ status: "识别中", emoji: "🤔", text: "" });
    const text = await recognizeAudio(filePath);
    // const text = await volcengineASR(filePath);
    // 调用字节跳动语音合成，播报识别结果
    display({ text });
    if (text) {
      await Promise.all([
        chatWithDoubaoStream(text, partial, endPartial),
        getPlayEndPromise(),
      ]);
    } else {
      console.log("识别结果为空, 请继续说");
    }
  }
})();
