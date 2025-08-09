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

dotenv.config();

// Doubao LLM
const doubaoAccessToken = process.env.VOLCENGINE_DOUBAO_ACCESS_TOKEN || "";
const doubaoLLMModel = process.env.VOLCENGINE_DOUBAO_LLM_MODEL || "doubao-1-5-lite-32k-250115"; // Default model

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
  if (!doubaoAccessToken) {
    console.error("Doubao access token is not set.");
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
    const response = await axios.post(
      "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
      {
        model: doubaoLLMModel,
        messages,
        stream: true,
        tools: llmTools,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${doubaoAccessToken}`,
        },
        responseType: "stream",
      }
    );

    response.data.on("data", (chunk: Buffer) => {
      const data = chunk.toString();
      const dataLines = data.split("\n");
      const filteredLines = dataLines.filter((line) => line.trim() !== "");
      const filteredData = filteredLines.map((line) =>
        line.replace(/^data:\s*/, "")
      );

      try {
        const parsedData = filteredData.map((line) => {
          if (line === "[DONE]") {
            return {}; // Handle end marker
          }
          return JSON.parse(line);
        });

        const answer = parsedData
          .map((item) => get(item, "choices[0].delta.content", ""))
          .join("");
        const toolCalls = parsedData
          .map((item) => get(item, "choices[0].delta.tool_calls", []))
          .filter((arr) => !isEmpty(arr));

        if (toolCalls.length) {
          functionCallsPackages.push(...toolCalls);
        }
        if (answer) {
          partialCallback(answer);
          partialAnswer += answer;
        }
      } catch (error) {
        console.error("Error parsing data:", error, data);
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
  }

  return promise;
};

export { chatWithLLMStream, resetChatHistory };
