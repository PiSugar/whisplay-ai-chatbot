import { Message, ToolReturnTag } from "../../type";
import {
  ChatWithLLMStreamFunction,
  ResetChatHistoryFunction,
  SummaryTextWithLLMFunction,
} from "../interface";
import { llmFuncMap } from "../../config/llm-tools";

const fixedReplies: string[] = [
    "The image has been generated, please check on the screen.",
    "Image generation complete! Take a look at the result.",
    "Your image is ready. Check it out on the display.",
    "Done! The generated image is now visible.",
    "Image created successfully. View it on your screen.",
    "The picture is ready for you to see.",
    "Your generated image is now available.",
    "Success! Your image has been created.",
    "The image generation is finished. Please view it.",
    "Check out your newly generated image on screen.",
];

const fixedFailureReplies: string[] = [
    "Sorry, the image generation failed. Please try again later.",
    "Oops, something went wrong with the image generation.",
    "I wasn't able to generate the image this time. Please try again.",
    "Image generation encountered an error. Let's try again.",
    "Unfortunately, the image could not be created right now.",
    "The image generation didn't work out. Please give it another try.",
    "I had trouble generating your image. Please try once more.",
    "Sorry, I couldn't create the image. Something went wrong.",
    "Image generation failed unexpectedly. Please retry.",
    "Apologies, the image could not be generated at this time.",
];



const imageContextRegex =
  /(this image|this picture|this photo|基于这张|这张图|这张图片|这张照片)/i;

const chatWithLLMStream: ChatWithLLMStreamFunction = async (
  inputMessages: Message[] = [],
  partialCallback: (partialAnswer: string) => void,
  endCallBack: () => void,
  _partialThinkingCallback?: (partialThinking: string) => void,
  invokeFunctionCallback?: (functionName: string, result?: string) => void,
): Promise<void> => {
  const fixedReply: string = fixedReplies[Math.floor(Math.random() * fixedReplies.length)] || "The image has been generated, please check on the screen.";
  const fixedFailureReply: string = fixedFailureReplies[Math.floor(Math.random() * fixedFailureReplies.length)] || "Sorry, the image generation failed. Please try again later.";
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
      partialCallback(fixedFailureReply);
      endCallBack();
      return;
    }

    invokeFunctionCallback?.("generateImage");
    const result = await generateImage({
      prompt,
      withImageContext: imageContextRegex.test(prompt),
    });
    invokeFunctionCallback?.("generateImage", result);

    if (result && result.startsWith(ToolReturnTag.Error)) {
      partialCallback(fixedFailureReply);
    } else {
      partialCallback(fixedReply);
    }
    endCallBack();
  } catch (error: any) {
    console.error("[ImageToolLLM] Error:", error);
    invokeFunctionCallback?.(
      "generateImage",
      `${ToolReturnTag.Error}${error?.message || "Image generation failed"}`,
    );
    partialCallback(fixedFailureReply);
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
