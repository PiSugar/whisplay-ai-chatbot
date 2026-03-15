import dotenv from "dotenv";
import fs from "fs";
import { Message } from "../../type";
import {
  ChatWithLLMStreamFunction,
  SummaryTextWithLLMFunction,
} from "../interface";
import {
  hasPendingCapturedImgForChat,
  consumePendingCapturedImgForChat,
} from "../../utils/image";

dotenv.config();

const whisplayBridgeHost = process.env.WHISPLAY_IM_BRIDGE_HOST || "127.0.0.1";
const whisplayBridgePort = parseInt(
  process.env.WHISPLAY_IM_BRIDGE_PORT || "18888",
);
const whisplayInboxPath =
  process.env.WHISPLAY_IM_INBOX_PATH || "/whisplay-im/inbox";
const whisplayToken = process.env.WHISPLAY_IM_TOKEN || "";
const whisplayTimeoutMs = parseInt(
  process.env.WHISPLAY_IM_TIMEOUT_MS || "30000",
);

const useCapturedImageInChat =
  (process.env.USE_CAPTURED_IMAGE_IN_CHAT || "false").toLowerCase() === "true";

const whisplayInboxUrl = `http://${whisplayBridgeHost}:${whisplayBridgePort}${whisplayInboxPath}`;

const resetChatHistory = (): void => {};

export const sendWhisplayIMMessage = async (
  inputMessages: Message[] = [],
): Promise<boolean> => {
  const lastUserMessage = [...inputMessages]
    .reverse()
    .find((msg) => msg.role === "user");

  // Check for pending captured image to include
  const capturedImagePath =
    useCapturedImageInChat && hasPendingCapturedImgForChat()
      ? consumePendingCapturedImgForChat()
      : "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), whisplayTimeoutMs);

  try {
    const body: Record<string, any> = {
      message: lastUserMessage?.content || "",
      messages: inputMessages,
    };

    // Attach image as base64 if available
    if (capturedImagePath && fs.existsSync(capturedImagePath)) {
      const ext = capturedImagePath.split(".").pop()?.toLowerCase() || "jpg";
      const mimeType =
        ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      const base64 = fs.readFileSync(capturedImagePath).toString("base64");
      body.imageBase64 = `data:${mimeType};base64,${base64}`;
      console.log(`[WhisplayIM] Attaching captured image: ${capturedImagePath}`);
    }

    const response = await fetch(whisplayInboxUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(whisplayToken ? { Authorization: `Bearer ${whisplayToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(`Whisplay IM HTTP error: ${response.status}`);
      return false;
    }

    return true;
  } catch (error: any) {
    if (error?.name === "AbortError") {
      console.error("Whisplay IM request timeout.");
    } else {
      console.error("Whisplay IM request failed:", error);
    }
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

const chatWithLLMStream: ChatWithLLMStreamFunction = async (
  inputMessages: Message[] = [],
  _partialCallback: (partialAnswer: string) => void,
  endCallback: () => void,
): Promise<void> => {
  await sendWhisplayIMMessage(inputMessages);
  endCallback();
};

const summaryTextWithLLM: SummaryTextWithLLMFunction = async (
  text: string,
): Promise<string> => text;

export default { chatWithLLMStream, resetChatHistory, summaryTextWithLLM };
