import axios from "axios";
import { get, isEmpty } from "lodash";
import {
  systemPrompt,
} from "../config/llm-config";
import { combineFunction } from "../utils";
import { llmTools, llmFuncMap } from "../config/llm-tools";
import dotenv from "dotenv";
import { FunctionCall, Message } from "../type";

dotenv.config();

// Ollama LLM configuration
const ollamaEndpoint = process.env.OLLAMA_ENDPOINT || "http://localhost:11434";
const ollamaModel = process.env.OLLAMA_MODEL || "deepseek-r1:1.5b";

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

const chatWithLLMStream = async (
  inputMessages: Message[] = [],
  partialCallback: (partialAnswer: string) => void,
  endCallback: () => void
): Promise<void> => {
  messages.push(...inputMessages);
  let endResolve: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    endResolve = resolve;
  });
  let partialAnswer = "";
  const functionCallsPackages: any[] = [];

  try {
    const response = await axios.post(
      `${ollamaEndpoint}/api/chat`,
      {
        model: ollamaModel,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        think: false,
        stream: true,
        options: {
          temperature: 0.7,
        },
        // tools: llmTools,
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

          // Handle tool calls from Ollama
          if (parsedData.message?.tool_calls) {
            functionCallsPackages.push(parsedData.message.tool_calls);
          }
          
        } catch (error) {
          console.error("Error parsing data:", error, line);
        }
      }
    });

    response.data.on("end", async () => {
      console.log("Stream ended");
      const functionCalls = combineFunction(functionCallsPackages);
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
    endCallback();
  }

  return promise;
};

export { chatWithLLMStream, resetChatHistory };
