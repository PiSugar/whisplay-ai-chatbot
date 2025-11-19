import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import moment from "moment";
import { get, isEmpty } from "lodash";
import {
  shouldResetChatHistory,
  systemPrompt,
  updateLastMessageTime,
} from "../../config/llm-config";
import { combineFunction } from "../../utils";
import { llmTools, llmFuncMap } from "../../config/llm-tools";
import dotenv from "dotenv";
import { FunctionCall, Message, ToolReturnTag } from "../../type";
import { ChatWithLLMStreamFunction } from "../interface";
import { chatHistoryDir } from "../../utils/dir";
import { extractToolResponse, stimulateStreamResponse } from "../../config/common";

dotenv.config();

// Grok LLM
const grokAccessToken = process.env.GROK_API_KEY || "";
const grokLLMModel = process.env.GROK_LLM_MODEL || "grok-4-latest"; // Default model

const chatHistoryFileName = `grok_chat_history_${moment().format(
  "YYYY-MM-DD_HH-mm-ss"
)}.json`;

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

const chatWithLLMStream: ChatWithLLMStreamFunction = async (
  inputMessages: Message[] = [],
  partialCallback: (partialAnswer: string) => void,
  endCallback: () => void,
  partialThinkingCallback?: (partialThinking: string) => void,
  invokeFunctionCallback?: (functionName: string, result?: string) => void
): Promise<void> => {
  if (!grokAccessToken) {
    console.error("Grok access token is not set.");
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
  }).finally(() => {
    fs.writeFileSync(
      path.join(chatHistoryDir, chatHistoryFileName),
      JSON.stringify(messages, null, 2)
    );
  });
  let partialAnswer = "";
  const functionCallsPackages: any[] = [];

  try {
    const response = await axios.post(
      "https://api.x.ai/v1/chat/completions",
      {
        model: grokLLMModel,
        messages,
        stream: true,
        tools: llmTools,
        temperature: 0.7,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${grokAccessToken}`,
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
            invokeFunctionCallback?.(name! as string);
            if (func) {
              return [
                id,
                await func(args)
                  .then((res) => {
                    invokeFunctionCallback?.(name! as string, res);
                    return res;
                  })
                  .catch((err) => {
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

        // Directly extract and return the tool result if available
        const describeMessage = newMessages.find((msg) =>
          msg.content.startsWith(ToolReturnTag.Response)
        );
        const responseContent = extractToolResponse(
          describeMessage?.content || ""
        );
        if (responseContent) {
          console.log(
            `[LLM] Tool response starts with "[response]", return it directly.`
          );
          newMessages.push({
            role: "assistant",
            content: responseContent,
          });
          // append responseContent in chunks
          await stimulateStreamResponse({
            content: responseContent,
            partialCallback,
            endResolve,
            endCallback,
          });
          return;
        }

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
