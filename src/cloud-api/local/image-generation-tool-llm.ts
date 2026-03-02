import { Message, ToolReturnTag } from "../../type";
import {
  ChatWithLLMStreamFunction,
  ResetChatHistoryFunction,
  SummaryTextWithLLMFunction,
} from "../interface";
import { llmFuncMap } from "../../config/llm-tools";

const fixedReply: string =
    process.env.IMAGE_TOOL_LLM_FIXED_REPLY ||
    "The image has been generated, please check on the screen.";

const imageContextRegex =
  /(this image|this picture|this photo|基于这张|这张图|这张图片|这张照片)/i;

const chatWithLLMStream: ChatWithLLMStreamFunction = async (
  inputMessages: Message[] = [],
  partialCallback: (partialAnswer: string) => void,
  endCallBack: () => void,
  _partialThinkingCallback?: (partialThinking: string) => void,
  invokeFunctionCallback?: (functionName: string, result?: string) => void,
): Promise<void> => {
  try {
    const lastUserMessage = [...inputMessages]
      .reverse()
      .find((message) => message.role === "user");
    const prompt = (lastUserMessage?.content || "").trim();

    if (!prompt) {
      partialCallback(fixedReply);
      endCallBack();
      return;
    }

    const generateImage = llmFuncMap.generateImage;
    if (!generateImage) {
      console.error("[ImageToolLLM] generateImage tool not found");
      invokeFunctionCallback?.(
        "generateImage",
        `${ToolReturnTag.Error}generateImage tool not found`,
      );
      partialCallback(fixedReply);
      endCallBack();
      return;
    }

    invokeFunctionCallback?.("generateImage");
    const result = await generateImage({
      prompt,
      withImageContext: imageContextRegex.test(prompt),
    });
    invokeFunctionCallback?.("generateImage", result);

    partialCallback(fixedReply);
    endCallBack();
  } catch (error: any) {
    console.error("[ImageToolLLM] Error:", error);
    invokeFunctionCallback?.(
      "generateImage",
      `${ToolReturnTag.Error}${error?.message || "Image generation failed"}`,
    );
    partialCallback(fixedReply);
    endCallBack();
  }
};

const resetChatHistory: ResetChatHistoryFunction = () => {
  return;
};

const summaryTextWithLLM: SummaryTextWithLLMFunction = async (
  text: string,
  _promptPrefix: string,
): Promise<string> => text;

export default {
  chatWithLLMStream,
  resetChatHistory,
  summaryTextWithLLM,
};
