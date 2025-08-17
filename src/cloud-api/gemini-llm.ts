import axios from "axios";
import { get, isEmpty } from "lodash";
import {
  shouldResetChatHistory,
  systemPrompt,
  updateLastMessageTime,
} from "../config/llm-config";
import { combineFunction } from "../utils";
import { llmTools, llmFuncMap } from "../config/llm-tools";
import dotenv from "dotenv";
import { FunctionCall, Message } from "../type";
import { ChatWithLLMStreamFunction } from "./interface";

dotenv.config();

// Google Gemini LLM
const geminiApiKey = process.env.GOOGLE_GEMINI_API_KEY || "";
const geminiModel = process.env.GOOGLE_GEMINI_MODEL || "gemini-1.5-flash";

const messages: Message[] = [
  {
    role: "system",
    content: systemPrompt,
  },
];

const resetChatHistory = (): void => {
  messages.length = 0;
  messages.push({
    role: "system",
    content: systemPrompt,
  });
};

// Convert messages to Gemini format
const convertMessagesToGeminiFormat = (messages: Message[]) => {
  return messages
    .filter(msg => msg.role !== "system")
    .map(msg => {
      if (msg.role === "user") {
        return { role: "user", parts: [{ text: msg.content }] };
      } else if (msg.role === "assistant") {
        return { role: "model", parts: [{ text: msg.content }] };
      } else if (msg.role === "tool") {
        return {
          role: "function",
          parts: [{
            functionResponse: {
              name: msg.tool_call_id,
              response: { result: msg.content }
            }
          }]
        };
      }
      return null;
    })
    .filter(Boolean);
};

// Convert tools to Gemini format
const convertToolsToGeminiFormat = (tools: any[]) => {
  return tools.map(tool => ({
    functionDeclarations: [{
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters
    }]
  }));
};

const chatWithLLMStream: ChatWithLLMStreamFunction = async (
  inputMessages: Message[] = [],
  partialCallback: (partialAnswer: string) => void,
  endCallback: () => void,
  partialThinkingCallback?: (partialThinking: string) => void
): Promise<void> => {
  if (!geminiApiKey) {
    console.error("Google Gemini API key is not set.");
    return;
  }
  
  if (shouldResetChatHistory()) {
    resetChatHistory();
  }
  updateLastMessageTime();
  messages.push(...inputMessages);
  
  let endResolve: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    endResolve = resolve;
  });
  
  let partialAnswer = "";
  const functionCallsPackages: any[] = [];

  try {
    const systemMessage = messages.find(msg => msg.role === "system");
    const geminiMessages = convertMessagesToGeminiFormat(messages);
    const geminiTools = convertToolsToGeminiFormat(llmTools);

    const requestBody = {
      contents: geminiMessages,
      tools: geminiTools,
      systemInstruction: systemMessage ? { parts: [{ text: systemMessage.content }] } : undefined,
      generationConfig: {
        temperature: 0.7,
      }
    };

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?key=${geminiApiKey}`,
      requestBody,
      {
        headers: {
          "Content-Type": "application/json",
        },
        responseType: "stream",
      }
    );

    response.data.on("data", (chunk: Buffer) => {
      const data = chunk.toString();
      const dataLines = data.split("\n");
      const filteredLines = dataLines.filter((line) => line.trim() !== "" && line.startsWith("data: "));
      
      filteredLines.forEach(line => {
        try {
          const jsonData = JSON.parse(line.replace("data: ", ""));
          
          if (jsonData.candidates && jsonData.candidates[0]) {
            const candidate = jsonData.candidates[0];
            
            // Handle text content
            if (candidate.content && candidate.content.parts) {
              candidate.content.parts.forEach((part: any) => {
                if (part.text) {
                  partialCallback(part.text);
                  partialAnswer += part.text;
                }
                
                // Handle function calls
                if (part.functionCall) {
                  functionCallsPackages.push({
                    id: `call_${Date.now()}_${Math.random()}`,
                    type: "function",
                    function: {
                      name: part.functionCall.name,
                      arguments: JSON.stringify(part.functionCall.args || {})
                    }
                  });
                }
              });
            }
          }
        } catch (error) {
          console.error("Error parsing Gemini response:", error, line);
        }
      });
    });

    response.data.on("end", async () => {
      console.log("Stream ended");
      const functionCalls = functionCallsPackages;
      console.log("functionCalls: ", JSON.stringify(functionCalls));
      
      messages.push({
        role: "assistant",
        content: partialAnswer,
        tool_calls: functionCalls,
      });

      if (!isEmpty(functionCalls)) {
        const results = await Promise.all(
          functionCalls.map(async (call: FunctionCall) => {
            const {
              function: { arguments: argString, name },
              id,
            } = call;
            let args: Record<string, any> = {};
            try {
              args = JSON.parse(argString || "{}");
            } catch {
              console.error(
                `Error parsing arguments for function ${name}:`,
                argString
              );
            }
            const func = llmFuncMap[name! as string];
            if (func) {
              return [id, await func(args)];
            } else {
              console.error(`Function ${name} not found`);
              return [id, `Function ${name} not found`];
            }
          })
        );

        console.log("call results: ", results);
        const newMessages: Message[] = results.map(([id, result]: any) => ({
          role: "tool",
          content: result as string,
          tool_call_id: id as string,
        }));

        await chatWithLLMStream(newMessages, partialCallback, () => {
          endResolve();
          endCallback();
        });
        return;
      } else {
        endResolve();
        endCallback();
      }
    });
  } catch (error: any) {
    console.error("Error:", error.message);
    endResolve();
  }

  return promise;
};

export { chatWithLLMStream, resetChatHistory };
