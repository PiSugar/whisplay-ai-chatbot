declare module "mp3-duration" {
  function duration(buffer: Buffer): Promise<number>;
  export = duration;
}

export type RecognizeAudioFunction = (audioPath: string) => Promise<any>;
export type ChatWithLLMStreamFunction = (
  inputMessages: Message[],
  partialCallback: (partialAnswer: string) => void,
  endCallBack: () => void,
  partialThinkingCallback?: (partialThinking: string) => void
) => Promise<any>;
export type ResetChatHistoryFunction = () => void;
export type TTSProcessorFunction = (text: string) => Promise<any>;