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
import {
  ChatWithLLMStreamFunction,
  SummaryTextWithLLMFunction,
} from "../interface";
import { chatHistoryDir } from "../../utils/dir";
import {
  extractToolResponse,
  stimulateStreamResponse,
} from "../../config/common";

dotenv.config();

const perplexityApiKey = process.env.PERPLEXITY_API_KEY || "";
const perplexityModel = process.env.PERPLEXITY_LLM_MODEL || "sonar";
// Tool calling is only available on select Perplexity models (e.g. sonar-pro).
// Set PERPLEXITY_ENABLE_TOOLS=true to enable.
const perplexityEnableTools =
  (process.env.PERPLEXITY_ENABLE_TOOLS || "false").toLowerCase() === "true";

const chatHistoryFileName = `perplexity_chat_history_${moment().format(
  "YYYY-MM-DD_HH-mm-ss",
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
  _partialThinkingCallback?: (partialThinking: string) => void,
  invokeFunctionCallback?: (functionName: string, result?: string) => void,
): Promise<void> => {
  if (!perplexityApiKey) {
    console.error("[Perplexity] API key is not set.");
    endCallback();
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
      JSON.stringify(messages, null, 2),
    );
  });

  let partialAnswer = "";
  const functionCallsPackages: any[] = [];

  try {
    const response = await axios.post(
      "https://api.perplexity.ai/chat/completions",
      {
        model: perplexityModel,
        messages,
        stream: true,
        ...(perplexityEnableTools ? { tools: llmTools } : {}),
        temperature: 0.7,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${perplexityApiKey}`,
        },
        responseType: "stream",
      },
    );

    response.data.on("data", (chunk: Buffer) => {
      const data = chunk.toString();
      const dataLines = data.split("\n");
      const filteredLines = dataLines.filter((line) => line.trim() !== "");
      const filteredData = filteredLines.map((line) =>
        line.replace(/^data:\s*/, ""),
      );

      try {
        const parsedData = filteredData.map((line) => {
          if (line === "[DONE]") return {};
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
        console.error("[Perplexity] Error parsing data:", error, data);
      }
    });

    response.data.on("end", async () => {
      console.log("[Perplexity] Stream ended");
      const functionCalls = combineFunction(functionCallsPackages);
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
                `[Perplexity] Error parsing arguments for function ${name}:`,
                argString,
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
                    console.error(
                      `[Perplexity] Error executing function ${name}:`,
                      err,
                    );
                    return `Error executing function ${name}: ${err.message}`;
                  }),
              ];
            } else {
              console.error(`[Perplexity] Function ${name} not found`);
              return [id, `Function ${name} not found`];
            }
          }),
        );

        const newMessages: Message[] = results.map(([id, result]: any) => ({
          role: "tool",
          content: result as string,
          tool_call_id: id as string,
        }));

        const describeMessage = newMessages.find((msg) =>
          msg.content.startsWith(ToolReturnTag.Response),
        );
        const responseContent = extractToolResponse(
          describeMessage?.content || "",
        );
        if (responseContent) {
          newMessages.push({ role: "assistant", content: responseContent });
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

    response.data.on("error", (err: Error) => {
      console.error("[Perplexity] Stream error:", err.message);
      endResolve();
      endCallback();
    });
  } catch (error: any) {
    console.error("[Perplexity] Error:", error.message);
    endResolve();
    endCallback();
  }

  return promise;
};

const summaryTextWithLLM: SummaryTextWithLLMFunction = async (
  text: string,
  promptPrefix: string,
): Promise<string> => {
  if (!perplexityApiKey) {
    console.error("[Perplexity] API key is not set. Using original text.");
    return text;
  }
  const response = await axios
    .post(
      "https://api.perplexity.ai/chat/completions",
      {
        model: perplexityModel,
        messages: [
          {
            role: "user",
            content: `${promptPrefix}\n\n${text}\n\n`,
          },
        ],
        stream: false,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${perplexityApiKey}`,
        },
      },
    )
    .catch((err) => {
      console.error("[Perplexity] Summary request failed:", err.message);
      return null;
    });
  if (!response) return text;
  const summary = get(response, "data.choices[0].message.content", "");
  return summary || text;
};

export default { chatWithLLMStream, resetChatHistory, summaryTextWithLLM };
