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
      status: "answering",
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

// flowStatus "sleep", "listen", "asr", "answer"
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

let currentStatus = "sleep";

const executeFlow = async (flowStatus, isButtonClick) => {
  if (flowStatus === currentStatus && !isButtonClick) return
  switch (flowStatus) {
    case "sleep":
      currentStatus = "sleep";
      console.log("待机");
      display({
        status: "idle",
        emoji: "😴",
        RGB: "#000055",
        text: "Press the button to start",
      });
      onButtonPressed(() => {
        executeFlow("listen", true);
      });
      break;
    case "listen":
      currentStatus = "listen";
      console.log("聆听中...");
      display({ status: "listening", emoji: "😐", RGB: "#00ff00" });
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
        executeFlow("sleep", true);
      });
      break;
    case "asr":
      currentStatus = "asr";
      console.log("识别中...");
      asrText = "";
      display({ status: "recognizing", emoji: "🤔", text: "" });
      let userStop = noop;
      Promise.race([
        recognizeAudio(recordFilePath).then((text) => {
          asrText = text;
          display({ text });
          if (text) {
            executeFlow("answer");
          } else {
            console.log("识别结果为空, 请继续说");
            executeFlow("listen");
          }
        }),
        new Promise((resolve) => {
          userStop = resolve;
        }),
      ]).then((result) => {
        if (result === "[UserStop]") {
          executeFlow("listen", true);
        }
      });
      onButtonPressed(() => {
        userStop("[UserStop]");
      });
      break;
    case "answer":
      currentStatus = "answer";
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
      ]).then((res) => {
        executeFlow("listen", res === "[UserStop]");
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
