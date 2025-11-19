import dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { isEmpty } from "lodash";
import moment from "moment";
import {
  shouldResetChatHistory,
  systemPrompt,
  updateLastMessageTime,
} from "../../config/llm-config";
import { FunctionCall, Message, ToolReturnTag } from "../../type";
import { combineFunction } from "../../utils";
import { openai } from "./openai"; // Assuming openai is exported from openai.ts
import { llmFuncMap, llmTools } from "../../config/llm-tools";
import { ChatWithLLMStreamFunction } from "../interface";
import { chatHistoryDir } from "../../utils/dir";

dotenv.config();
// OpenAI LLM
const openaiLLMModel = process.env.OPENAI_LLM_MODEL || "gpt-4o"; // Default model

const chatHistoryFileName = `openai_chat_history_${moment().format(
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
  partialCallback: (partial: string) => void,
  endCallback: () => void,
  partialThinkingCallback?: (partialThinking: string) => void,
  invokeFunctionCallback?: (functionName: string, result?: string) => void
): Promise<void> => {
  if (!openai) {
    console.error("OpenAI API key is not set.");
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
    fs.writeFileSync(
      path.join(chatHistoryDir, chatHistoryFileName),
      JSON.stringify(messages, null, 2)
    );
  });
  messages.push(...inputMessages);
  const chatCompletion = await openai.chat.completions.create({
    model: openaiLLMModel,
    messages: messages as any,
    stream: true,
    tools: llmTools,
  });
  let partialAnswer = "";
  let partialThinking = "";
  const functionCallsPackages: any[] = [];
  for await (const chunk of chatCompletion) {
    if (chunk.choices[0].delta.content) {
      partialCallback(chunk.choices[0].delta.content);
      partialAnswer += chunk.choices[0].delta.content;
    }
    // openai does not have "thinking" field
    // if (chunk.choices[0].delta.thinking) {
    //   partialThinkingCallback?.(chunk.choices[0].delta.thinking);
    //   partialThinking += chunk.choices[0].delta.thinking;
    // }
    if (chunk.choices[0].delta.tool_calls) {
      functionCallsPackages.push(...chunk.choices[0].delta.tool_calls);
    }
  }
  const answer = partialAnswer;
  const functionCalls = combineFunction(functionCallsPackages);
  messages.push({
    role: "assistant",
    content: answer,
    tool_calls: isEmpty(functionCalls) ? undefined : functionCalls,
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

    await chatWithLLMStream(newMessages, partialCallback, () => {
      endResolve();
      endCallback();
    });
    return;
  } else {
    endResolve();
    endCallback();
  }
  return promise;
};

export { chatWithLLMStream, resetChatHistory };
