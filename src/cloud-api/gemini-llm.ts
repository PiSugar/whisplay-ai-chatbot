import { isEmpty } from "lodash";
import * as fs from "fs";
import * as path from "path";
import { LLMTool } from "../type";
import {
  shouldResetChatHistory,
  systemPrompt,
  updateLastMessageTime,
} from "../config/llm-config";
import { gemini, geminiModel } from "./gemini";
import { llmTools, llmFuncMap, llmToolsForGemini } from "../config/llm-tools";
import dotenv from "dotenv";
import { FunctionCall, Message } from "../type";
import { ChatWithLLMStreamFunction } from "./interface";
import { ToolListUnion, ToolUnion, Part } from "@google/genai";
import moment from "moment";
import { chatHistoryDir } from "../utils/dir";

dotenv.config();

const chatHistoryFileName = `gemini_chat_history_${moment().format(
  "YYYYMMDD_HHmmss"
)}.json`;

const resetChatHistory = (): void => {
  // messages.length = 0;
  // messages.push({
  //   role: "system",
  //   content: systemPrompt,
  // });
};

// Convert tools to Gemini format
const convertToolsToGeminiFormat = (tools: LLMTool[]): ToolListUnion => {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      })),
    } as ToolUnion,
  ];
};

const chat = gemini?.chats.create({
  model: geminiModel,
  config: {
    tools: convertToolsToGeminiFormat(llmToolsForGemini),
    systemInstruction: {
      parts: [{ text: systemPrompt }],
      role: "system",
    },
  },
});

const chatWithLLMStream: ChatWithLLMStreamFunction = async (
  inputMessages: Message[] = [],
  partialCallback: (partialAnswer: string) => void,
  endCallback: () => void,
  partialThinkingCallback?: (partialThinking: string) => void
): Promise<void> => {
  if (!gemini || !chat) {
    console.error("Google Gemini API key is not set.");
    return;
  }

  if (shouldResetChatHistory()) {
    resetChatHistory();
  }
  updateLastMessageTime();

  let endResolve: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    endResolve = resolve;
  }).finally(() => {
    // save chat history to file
    fs.writeFileSync(
      path.join(chatHistoryDir, chatHistoryFileName),
      JSON.stringify(chat.getHistory(), null, 2)
    );
  });

  let partialAnswer = "";
  const functionCallsPackages: any[] = [];

  try {
    const geminiPart: Part[] = inputMessages
      .map((msg) => {
        if (msg.role === "user") {
          return { text: msg.content };
        } else if (msg.role === "assistant") {
          return { text: msg.content };
        } else if (msg.role === "tool") {
          return {
            functionResponse: {
              name: msg.tool_call_id!,
              response: { result: msg.content },
            },
          };
        }
        return null;
      })
      .filter((item) => item !== null) as Part[];

    const response = await chat.sendMessageStream({
      message: geminiPart,
    });

    for await (const chunk of response) {
      const chunkText = chunk.text;
      if (chunkText) {
        partialCallback(chunkText);
        partialAnswer += chunkText;
      }

      // Handle function calls
      const functionCalls = chunk.functionCalls;
      if (functionCalls) {
        functionCalls.forEach((call: any) => {
          functionCallsPackages.push({
            id: `call_${Date.now()}_${Math.random()}`,
            type: "function",
            function: {
              name: call.name,
              arguments: JSON.stringify(call.args || {}),
            },
          });
        });
      }
    }

    console.log("Stream ended");
    const functionCalls = functionCallsPackages;
    console.log("functionCalls: ", JSON.stringify(functionCalls));

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
            return [
              id,
              await func(args).catch((err) => {
                console.error(`Error executing function ${name}:`, err);
                return `Error executing function ${name}: ${err.message}`;
              }),
            ];
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
  } catch (error: any) {
    console.error("Error:", error.message);
    endResolve();
  }

  return promise;
};

export { chatWithLLMStream, resetChatHistory };
