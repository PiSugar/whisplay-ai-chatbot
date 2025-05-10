const fs = require("fs");
const path = require("path");
const { display, extractEmojis, onButtonPressed } = require("./device/display");
const {
  recordAudio,
  StreamResponser,
  stopRecording,
} = require("./device/audio");
const {
  chatWithLLMStream,
  recognizeAudio,
  ttsProcessor,
} = require("./cloud-api/server");
const { noop } = require("lodash");

const {
  partial,
  endPartial,
  getPlayEndPromise,
  stop: stopPlaying,
} = new StreamResponser(
  ttsProcessor,
  (sentences) => {
    const fullText = sentences.join("");
    display({
      status: "回答中",
      emoji: extractEmojis(fullText) || "😊",
      text: fullText,
      RGB: "#0000ff",
    });
  },
  (text) => {
    console.log("完整回答:", text);
    display({
      text,
    });
  }
);

// flowStatus "sleep", "listen", "asr", "anwser"
let recordFilePath = "";
let asrText = "";

// if data folder not exist, create it
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
  console.log("创建数据文件夹:", dataDir);
} else {
  console.log("数据文件夹已存在:", dataDir);
}

const executeFlow = async (flowStatus) => {
  switch (flowStatus) {
    case "sleep":
      console.log("待机");
      display({
        status: "待机",
        emoji: "😴",
        RGB: "#000055",
        text: "单击按钮开始讲话",
      });
      onButtonPressed(() => {
        executeFlow("listen");
      });
      break;
    case "listen":
      console.log("聆听中...");
      display({ status: "正在聆听", emoji: "😐", RGB: "#00ff00" });
      recordFilePath = `${dataDir}/user-${Date.now()}.mp3`;
      recordAudio(recordFilePath, 60)
        .then(() => {
          executeFlow("asr");
        })
        .catch((err) => {
          console.error("录音错误:", err);
          executeFlow("listen");
        });
      onButtonPressed(() => {
        stopRecording();
        executeFlow("sleep");
      });
      break;
    case "asr":
      console.log("识别中...");
      asrText = "";
      display({ status: "识别中", emoji: "🤔", text: "" });
      let userStop = noop;
      Promise.race([
        recognizeAudio(recordFilePath).then((text) => {
          asrText = text;
          display({ text });
          if (text) {
            executeFlow("anwser");
          } else {
            console.log("识别结果为空, 请继续说");
            display({ status: "请继续说" });
            executeFlow("listen");
          }
        }),
        new Promise((resolve) => {
          userStop = resolve;
        }),
      ]).then((result) => {
        if (result === "[UserStop]") {
          executeFlow("listen");
        }
      });
      onButtonPressed(() => {
        userStop("[UserStop]");
      });
      break;
    case "anwser":
      console.log("回答中...");
      let userStopAnser = noop;
      const answerPromise = Promise.all([
        chatWithLLMStream([{
          role: 'user',
          content: asrText,
        }], partial, endPartial),
        getPlayEndPromise(),
      ]);
      Promise.race([
        answerPromise,
        new Promise((resolve) => {
          userStopAnser = resolve;
        }),
      ]).then(() => {
        executeFlow("listen");
      });
      onButtonPressed(() => {
        userStopAnser("[UserStop]");
        stopPlaying();
      });
      break;
  }
};

(async () => {
  executeFlow("sleep");
})();
