import { Message } from "../type";

export type RecognizeAudioFunction = (audioPath: string) => Promise<any>;
export type ChatWithLLMStreamFunction = (
  inputMessages: Message[],
  partialCallback: (partialAnswer: string) => void,
  endCallBack: () => void,
  partialThinkingCallback?: (partialThinking: string) => void
) => Promise<any>;
export type ResetChatHistoryFunction = () => void;
export type TTSProcessorFunction = (text: string) => Promise<any>;