export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: FunctionCall[];
  tool_call_id?: string;
}

export interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string
  tool_calls?: OllamaFunctionCall[][];
  tool_name?: string;
}

export enum ASRServer {
  volcengine = "volcengine",
  tencent = "tencent",
  openai = "openai",
  gemini = "gemini",
  vosk = "vosk",
  whisper = "whisper",
  llm8850whisper = "llm8850whisper",
}

export enum LLMServer {
  volcengine = "volcengine",
  openai = "openai",
  ollama = "ollama",
  gemini = "gemini",
  grok = "grok",
  llm8850 = "llm8850",
}

export enum TTSServer {
  volcengine = "volcengine",
  openai = "openai",
  tencent = "tencent",
  gemini = "gemini",
  piper = "piper",
  llm8850melotts = "llm8850melotts",
}

export enum ImageGenerationServer {
  openai = "openai",
  gemini = "gemini",
  volcengine = "volcengine",
}

export enum VisionServer {
  ollama = "ollama",
  openai = "openai",
  gemini = "gemini",
  volcengine = "volcengine",
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

// {"function":{"index":0,"name":"setVolume","arguments":{"percent":50}}}
export interface OllamaFunctionCall {
  function: {
    index: number;
    name: string;
    arguments: Record<string, any>;
  };
}


export type LLMFunc = (params: any) => Promise<string>

export interface LLMTool {
  id?: string;
  type: "function";
  function: {
    name: string
    description: string
    parameters: {
      type?: string
      properties?: {
        [key: string]: {
          type: string
          description: string
          enum?: string[]
          items?: {
            type: string
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
        description: string
      }
      required?: string[]
    }
  }
  func: LLMFunc
}

export enum ToolReturnTag {
  Success = "[success]",
  Error = "[error]",
  Response = "[response]", // use as assistant response
}
