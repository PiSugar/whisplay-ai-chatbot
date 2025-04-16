const chatWithDoubao = require("./cloud-api/doubao-llm");
const volcengineTTS = require("./cloud-api/volcengine-tts");
const volcengineASR = require("./cloud-api/volcengine-asr");
const { recognizeAudio } = require("./cloud-api/tencent-cloud");
const { main: display } = require("./display");
const { recordAudio, playAudioData } = require("./device/audio");


(async () => {

  display();
  const filePath = "record.mp3";

  while (true) {
    console.log("聆听中...");
    await recordAudio(filePath, 60);
    console.log("识别中...");
    const text = await recognizeAudio(filePath);
    // const text = await volcengineASR(filePath);

    // 调用腾讯云语音合成，播报识别结果
    // const audioData = await synthesizeSpeech(res);
    // 调用字节跳动语音合成，播报识别结果
    if (text) {
      const answer = await chatWithDoubao(text);
      if (answer) {
        const { data: audioData, duration } = await volcengineTTS(answer);
        // 播放合成的音频
        await playAudioData(audioData, duration);
      }
    } else {
      console.log("识别结果为空, 请继续说");
    }
  }
})();

