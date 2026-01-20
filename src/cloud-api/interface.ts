import { Message } from "../type";

export type RecognizeAudioFunction = (audioPath: string) => Promise<any>;
export type ChatWithLLMStreamFunction = (
  inputMessages: Message[],
  partialCallback: (partialAnswer: string) => void,
  endCallBack: () => void,
  partialThinkingCallback?: (partialThinking: string) => void,
  invokeFunctionCallback?: (functionName: string, result?: string) => void
) => Promise<any>;
export type ResetChatHistoryFunction = () => void;
export type TTSProcessorFunction = (text: string) => Promise<any>;


export interface VectorDBClass {
  getCollections(): Promise<string[]>;
  deleteCollection(collectionName: string): Promise<void>;
  createCollection(
    collectionName: string,
    vectorSize: number,
    distance: "Cosine" | "Dot" | "Euclid"
  ): Promise<void>;
  upsertPoints(
    collectionName: string,
    points: Array<{
      id: number | string;
      vector: number[];
      payload?: Record<string, any>;
    }>
  ): Promise<void>;
  search(
    collectionName: string,
    queryVector: number[],
    limit: number,
    filter?: any
  ): Promise<any>;
  retrieve(collectionName: string, ids: Array<number | string>): Promise<any>;
}