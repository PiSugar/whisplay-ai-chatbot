import dotenv from "dotenv";
import { isEmpty } from "lodash";
import {
  shouldResetChatHistory,
  systemPrompt,
  updateLastMessageTime,
} from "../config/llm-config";
import { FunctionCall, Message } from "../type";
import { combineFunction } from "../utils";
import { openai } from "./openai"; // Assuming openai is exported from openai.ts
import { llmFuncMap, llmTools } from "../config/llm-tools";
import { ChatWithLLMStreamFunction } from "./type";

dotenv.config();
// OpenAI LLM
const openaiLLMModel = process.env.OPENAI_LLM_MODEL || "gpt-4o"; // Default model

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
  partialThinkingCallback?: (partialThinking: string) => void
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
  });
  messages.push(...inputMessages);
  const chatCompletion = await openai.chat.completions.create({
    model: openaiLLMModel,
    messages: messages as any,
    stream: true,
    tools: llmTools as any,
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
  return promise;
};

export { chatWithLLMStream, resetChatHistory };
