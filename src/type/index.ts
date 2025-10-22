import { Type as GeminiType } from "@google/genai";
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: FunctionCall[];
  tool_call_id?: string;
}

export enum ASRServer {
  volcengine = "volcengine",
  tencent = "tencent",
  openai = "openai",
  gemini = "gemini",
}

export enum LLMServer {
  volcengine = "volcengine",
  openai = "openai",
  ollama = "ollama",
  gemini = "gemini",
}

export enum TTSServer {
  volcengine = "volcengine",
  openai = "openai",
  tencent = "tencent",
  gemini = "gemini",
  piper = "piper",
}

export interface FunctionCall {
  function: {
    arguments: string;
    name?: string;
  };
  id?: string;
  index: number;
  type?: string;
}


export type LLMFunc = (params: Record<string, any>) => Promise<string>

export interface LLMTool {
  id?: string;
  type: "function";
  function: {
    name: string
    description: string
    parameters: {
      type?: string
      geminiType?: GeminiType
      properties?: {
        [key: string]: {
          type: string
          geminiType?: GeminiType
          description: string
          enum?: string[]
          items?: {
            type: string
            geminiType?: GeminiType
            description?: string
            properties?: {
              [key: string]: {
                type: string
                description: string
              }
            }
            required?: string[]
          }
        }
      }
      items?: {
        type: string
        geminiType?: GeminiType
        description: string
      }
      required?: string[]
    }
  }
  func: LLMFunc
}
