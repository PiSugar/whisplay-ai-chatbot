import { noop } from "lodash";
import dotenv from "dotenv";
import { recognizeAudio as VolcengineASR } from "./volcengine-asr";
import {
  recognizeAudio as TencentASR,
  synthesizeSpeech as TencentTTS,
} from "./tencent-cloud";
import { recognizeAudio as OpenAIASR } from "./openai-asr";
import {
  chatWithLLMStream as VolcengineLLMStream,
  resetChatHistory as VolcengineResetChatHistory,
} from "./volcengine-llm";
import {
  chatWithLLMStream as OpenAILLMStream,
  resetChatHistory as OpenAIResetChatHistory,
} from "./openai-llm";
import VolcengineTTS from "./volcengine-tts";
import OpenAITTS from "./openai-tts";

dotenv.config();

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

type RecognizeAudioFunction = (audioPath: string) => Promise<any>;
type ChatWithLLMStreamFunction = (
  inputMessages: Message[],
  partialCallback: (partialAnswer: string) => void,
  endCallBack: () => void
) => Promise<any>;
type ResetChatHistoryFunction = () => void;
type TTSProcessorFunction = (text: string) => Promise<any>;

let recognizeAudio: RecognizeAudioFunction = noop as any;
let chatWithLLMStream: ChatWithLLMStreamFunction = noop as any;
let ttsProcessor: TTSProcessorFunction = noop as any;
let resetChatHistory: ResetChatHistoryFunction = noop as any;

const asrServer = process.env.ASR_SERVER || "TENCENT";
const llmServer = process.env.LLM_SERVER || "VOLCENGINE";
const ttsServer = process.env.TTS_SERVER || "VOLCENGINE";

switch (asrServer) {
  case "VOLCENGINE":
    recognizeAudio = VolcengineASR;
    break;
  case "TENCENT":
    recognizeAudio = TencentASR;
    break;
  case "OPENAI":
    recognizeAudio = OpenAIASR;
    break;
  default:
    console.warn(
      `unknown asr server: ${asrServer}, should be VOLCENGINE/TENCENT/OPENAI`
    );
    break;
}

switch (llmServer) {
  case "VOLCENGINE":
    chatWithLLMStream = VolcengineLLMStream;
    resetChatHistory = VolcengineResetChatHistory;
    break;
  case "OPENAI":
    chatWithLLMStream = OpenAILLMStream;
    resetChatHistory = OpenAIResetChatHistory;
    break;
  default:
    console.warn(
      `unknown llm server: ${llmServer}, should be VOLCENGINE/OPENAI`
    );
    break;
}

switch (ttsServer) {
  case "VOLCENGINE":
    ttsProcessor = VolcengineTTS;
    break;
  case "OPENAI":
    ttsProcessor = OpenAITTS;
    break;
  case "TENCENT":
    ttsProcessor = TencentTTS;
    break;
  default:
    console.warn(
      `unknown tts server: ${ttsServer}, should be VOLCENGINE/TENCENT/OPENAI`
    );
    break;
}

export { recognizeAudio, chatWithLLMStream, ttsProcessor, resetChatHistory };
