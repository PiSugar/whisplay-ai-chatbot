const { noop } = require("lodash");
require("dotenv").config();

let recognizeAudio = noop;
let chatWithLLMStream = noop;
let ttsProcessor = noop;

const asrServer = process.env.ASR_SERVER || "TENCENT";
const llmServer = process.env.LLM_SERVER || "VOLCENGINE";
const ttsServer = process.env.TTS_SERVER || "VOLCENGINE";

switch (asrServer) {
  case "VOLCENGINE":
    recognizeAudio = require("./volcengine-asr").recognizeAudio;
    break;
  case "TENCENT":
    recognizeAudio = require("./tencent-cloud").recognizeAudio;
    break;
  case "OPENAI":
    recognizeAudio = require("./openai-asr").recognizeAudio;
    break;
  default:
    console.warn(`unknown asr server: ${asrServer}, should be VOLCENGINE/TENCENT/OPENAI`);
    break;
}

switch (llmServer) {
  case "VOLCENGINE":
    chatWithLLMStream = require("./volcengine-llm").chatWithLLMStream;
    break;
  case "OPENAI":
    chatWithLLMStream = require("./openai-llm").chatWithLLMStream;
    break;
  default:
    console.warn(`unknown llm server: ${llmServer}, should be VOLCENGINE/OPENAI`);
    break;
}

switch (ttsServer) {
  case "VOLCENGINE":
    ttsProcessor = require("./volcengine-tts");
    break;
  case "OPENAI":
    ttsProcessor = require("./openai-tts");
    break;
  case "TENCENT":
    ttsProcessor = require("./tencent-cloud").synthesizeSpeech;
    break;
  default:
    console.warn(`unknown tts server: ${ttsServer}, should be VOLCENGINE/TENCENT/OPENAI`);
    break;
}

module.exports = {
  recognizeAudio,
  chatWithLLMStream,
  ttsProcessor,
};