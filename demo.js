const { chatWithDoubaoStream } = require("./cloud-api/doubao-llm");
const volcengineTTS = require("./cloud-api/volcengine-tts");
const { createSteamResponser } = require("./device/audio");

const { partial, endPartial, getPlayEndPromise } =
  createSteamResponser(volcengineTTS, (text) => {
    console.log("完整回复:", text);
  });

// main
(async () => {
  const text = "你好，可以给我介绍一下广州有哪些好吃的吗？";

  await Promise.all([
    chatWithDoubaoStream(text, partial, endPartial),
    getPlayEndPromise(),
  ]);

  console.log("播放结束");
})();
