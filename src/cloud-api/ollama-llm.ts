import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { get, isEmpty, partial } from "lodash";
import {
  shouldResetChatHistory,
  systemPrompt,
  updateLastMessageTime,
} from "../config/llm-config";
import { combineFunction } from "../utils";
import { llmTools, llmFuncMap } from "../config/llm-tools";
import dotenv from "dotenv";
import { FunctionCall, Message, OllamaFunctionCall, OllamaMessage } from "../type";
import { ChatWithLLMStreamFunction } from "./interface";
import { chatHistoryDir } from "../utils/dir";
import moment from "moment";

dotenv.config();

// Ollama LLM configuration
const ollamaEndpoint = process.env.OLLAMA_ENDPOINT || "http://localhost:11434";
const ollamaModel = process.env.OLLAMA_MODEL || "deepseek-r1:1.5b";
const ollamaEnableTools = process.env.OLLAMA_ENABLE_TOOLS === "true";
const enableThinking = process.env.ENABLE_THINKING === "true";

const chatHistoryFileName = `ollama_chat_history_${moment().format(
  "YYYYMMDD_HHmmss"
)}.json`;

const messages: OllamaMessage[] = [
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

const chatWithLLMStream: ChatWithLLMStreamFunction = async (
  inputMessages: Message[] = [],
  partialCallback: (partialAnswer: string) => void,
  endCallback: () => void,
  partialThinkingCallback?: (partialThinking: string) => void
): Promise<void> => {
  if (shouldResetChatHistory()) {
    resetChatHistory();
  }
  updateLastMessageTime();
  messages.push(...inputMessages as OllamaMessage[]);
  let endResolve: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    endResolve = resolve;
  }).finally(() => {
    // save chat history to file
    fs.writeFileSync(
      path.join(chatHistoryDir, chatHistoryFileName),
      JSON.stringify(messages, null, 2)
    );
  });
  let partialAnswer = "";
  let partialThinking = "";
  const functionCallsPackages: OllamaFunctionCall[][] = [];

  try {
    const response = await axios.post(
      `${ollamaEndpoint}/api/chat`,
      {
        model: ollamaModel,
        messages: messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        think: enableThinking,
        stream: true,
        options: {
          temperature: 0.7,
        },
        tools: ollamaEnableTools ? llmTools : [],
      },
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
      const filteredLines = dataLines.filter((line) => line.trim() !== "");

      for (const line of filteredLines) {
        try {
          const parsedData = JSON.parse(line);

          // Handle content from Ollama
          if (parsedData.message?.content) {
            const content = parsedData.message.content;
            partialCallback(content);
            partialAnswer += content;
          }

          // Handle thinking from Ollama
          if (parsedData.message?.thinking) {
            const thinking = parsedData.message.thinking;
            partialThinkingCallback?.(thinking);
            partialThinking += thinking;
          }

          // Handle tool calls from Ollama
          if (parsedData.message?.tool_calls) {
            // tool_calls format: [[{"function":{"index":0,"name":"setVolume","arguments":{"percent":50}}}]]
            functionCallsPackages.push(parsedData.message.tool_calls);
          }
        } catch (error) {
          console.error("Error parsing data:", error, line);
        }
      }
    });

    response.data.on("end", async () => {
      console.log("Stream ended");
      const functionCalls = functionCallsPackages
        .flat()
        .map((call, index) => ({
          id: `call_${Date.now()}_${Math.random()}_${index}`,
          type: "function",
          function: call.function,
        }));
      console.log("functionCallsPackages: ", JSON.stringify(functionCallsPackages));
      console.log("functionCalls: ", JSON.stringify(functionCalls));
      messages.push({
        role: "assistant",
        content: partialAnswer,
        tool_calls: functionCallsPackages as any,
      });

      if (!isEmpty(functionCalls)) {
        const results = await Promise.all(
          functionCalls.map(async (call: OllamaFunctionCall) => {
            const {
              function: { arguments: args, name },
            } = call;
            const func = llmFuncMap[name! as string];
            if (func) {
              return [
                name,
                await func(args).catch((err) => {
                  console.error(`Error executing function ${name}:`, err);
                  return `Error executing function ${name}: ${err.message}`;
                }),
              ];
            } else {
              console.error(`Function ${name} not found`);
              return [name, `Function ${name} not found`];
            }
          })
        );

        console.log("call results: ", results);
        const newMessages: OllamaMessage[] = results.map(([name, result]: any) => ({
          role: "tool",
          content: result as string,
          tool_name: name as string,
        }));

        await chatWithLLMStream(newMessages as Message[], partialCallback, () => {
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
    endCallback();
  }

  return promise;
};

export { chatWithLLMStream, resetChatHistory };
