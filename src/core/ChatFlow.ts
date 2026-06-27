import {
  getCurrentTimeTag,
  getRecordFileDurationMs,
  splitSentences,
} from "./../utils/index";
import { display } from "../device/display";
import { recognizeAudio, ttsProcessor } from "../cloud-api/server";
import { isImMode } from "../cloud-api/llm";
import { DEFAULT_EMOJI, extractEmojis } from "../utils";
import { StreamResponser } from "./StreamResponsor";
import { recordingsDir } from "../utils/dir";
import dotEnv from "dotenv";
import { WakeWordListener } from "../device/wakeword";
import {
  WhisplayIMBridgeServer,
  type WhisplayIMApprovalRequest,
} from "../device/im-bridge";
import { FlowStateMachine } from "./chat-flow/stateMachine";
import { flowStates } from "./chat-flow/states";
import { ChatFlowContext, FlowName } from "./chat-flow/types";
import { playWakeupChime } from "../device/audio";
import { stopMusicPlayback, isMusicPlaying } from "../device/music-player";
import type { Status } from "../device/display";

dotEnv.config();

class ChatFlow implements ChatFlowContext {
  currentFlowName: FlowName = "sleep";
  recordingsDir: string = "";
  currentRecordFilePath: string = "";
  asrText: string = "";
  streamResponser: StreamResponser;
  partialThinking: string = "";
  thinkingSentences: string[] = [];
  answerId: number = 0;
  enableCamera: boolean = false;
  knowledgePrompts: string[] = [];
  wakeWordListener: WakeWordListener | null = null;
  wakeSessionActive: boolean = false;
  wakeSessionStartAt: number = 0;
  wakeSessionLastSpeechAt: number = 0;
  wakeSessionIdleTimeoutMs: number =
    parseInt(process.env.WAKE_WORD_IDLE_TIMEOUT_SEC || "60") * 1000;
  wakeRecordMaxSec: number = parseInt(
    process.env.WAKE_WORD_RECORD_MAX_SEC || "60",
  );
  wakeEndKeywords: string[] = (process.env.WAKE_WORD_END_KEYWORDS || "byebye,goodbye,stop,byebye").toLowerCase()
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  endAfterAnswer: boolean = false;
  whisplayIMBridge: WhisplayIMBridgeServer | null = null;
  pendingExternalReply: string = "";
  pendingExternalEmoji: string = "";
  pendingExternalImageUrl: string = "";
  pendingApprovalRequest: WhisplayIMApprovalRequest | null = null;
  currentExternalEmoji: string = "";
  stateMachine: FlowStateMachine;
  isFromWakeListening: boolean = false;
  enterMusicAfterAnswer: boolean = false;
  musicDisplayText: string = "";
  toolDisplayText: string = "";
  answerDisplayText: string = "";
  private toolDisplayItems: {
    id: string;
    name: string;
    anchorIndex: number;
    startedAt: number;
    elapsedSeconds?: number;
    timer?: ReturnType<typeof setInterval>;
    backgroundJobId?: string;
  }[] = [];
  private toolDisplaySeq = 0;
  private answerDisplayTimer?: ReturnType<typeof setTimeout>;
  private lastAnswerDisplayAt = 0;

  constructor(options: { enableCamera?: boolean } = {}) {
    console.log(`[${getCurrentTimeTag()}] ChatBot started.`);
    this.recordingsDir = recordingsDir;
    this.stateMachine = new FlowStateMachine(this, flowStates);
    this.streamResponser = new StreamResponser(
      ttsProcessor,
      (sentences: string[]) => {
        if (!this.isAnswerFlow()) return;
        const fullText = sentences.join(" ");
        let emoji = DEFAULT_EMOJI;
        if (this.currentFlowName === "external_answer") {
          emoji = this.currentExternalEmoji || extractEmojis(fullText) || emoji;
        } else {
          emoji = extractEmojis(fullText) || emoji;
        }
        display({
          status: "answering",
          emoji,
          terminal_text: "",
          RGB: "#0000ff",
          scroll_speed: 3,
        });
      },
      (text: string) => {
        if (!this.isAnswerFlow()) return;
        if (!this.answerDisplayText) {
          this.updateAnswerDisplayText(text || "");
        }
      },
      ({ charEnd, durationMs }) => {
        if (!this.isAnswerFlow()) return;
        if (!durationMs || durationMs <= 0) return;
        display({
          scroll_sync: {
            char_end: charEnd,
            duration_ms: durationMs,
          },
        });
      }
    );
    if (options?.enableCamera) {
      this.enableCamera = true;
    }

    this.transitionTo("sleep");

    const wakeEnabled = (process.env.WAKE_WORD_ENABLED || "").toLowerCase();
    if (wakeEnabled === "true") {
      this.wakeWordListener = new WakeWordListener();
      this.wakeWordListener.on("wake", () => {
        if (this.currentFlowName === "sleep") {
          this.startWakeSession();
        }
      });
      this.wakeWordListener.start();
    }

    if (isImMode) {
      this.whisplayIMBridge = new WhisplayIMBridgeServer();
      this.whisplayIMBridge.on(
        "reply",
        (payload: { reply: string; emoji?: string; imagePath?: string }) => {
          this.pendingExternalReply = payload.reply;
          this.pendingExternalEmoji = payload.emoji || "";
          this.pendingExternalImageUrl = payload.imagePath || "";
          this.transitionTo("external_answer");
        },
      );
      this.whisplayIMBridge.on(
        "status",
        (payload: { status: string; emoji?: string; text?: string; tool?: string }) => {
          const statusText = payload.tool
            ? `[${payload.tool}] ${payload.text || ""}`
            : payload.text || "";
          const textInputEnabled =
            payload.status === "idle" && this.currentFlowName === "sleep";
          const statusMap: Record<string, Partial<Status>> = {
            thinking: {
              status: "Thinking",
              emoji: payload.emoji || "🤔",
              text: statusText,
              RGB: "#ff6800",
              scroll_speed: 6,
              text_input_enabled: false,
            },
            tool_calling: {
              status: "Tool calling",
              emoji: payload.emoji || "🔧",
              text: statusText,
              RGB: "#ff6800",
              scroll_speed: 4,
              text_input_enabled: false,
            },
            answering: {
              status: "answering...",
              emoji: payload.emoji || "💬",
              RGB: "#00c8a3",
              text_input_enabled: false,
            },
            idle: {
              status: "idle",
              emoji: payload.emoji || "😊",
              RGB: "#000055",
              text_input_enabled: textInputEnabled,
            },
          };
          const displayPayload = statusMap[payload.status] || {
            status: payload.status,
            emoji: payload.emoji || "🤖",
            text: statusText,
            RGB: "#ff6800",
            text_input_enabled: false,
          };
          display(displayPayload);
        },
      );
      this.whisplayIMBridge.on(
        "approval",
        (request: WhisplayIMApprovalRequest) => {
          if (this.pendingApprovalRequest) {
            request.respond(false);
            return;
          }
          this.pendingApprovalRequest = request;
          this.transitionTo("approval");
        },
      );
      this.whisplayIMBridge.start();
    }
  }

  async recognizeAudio(path: string, isFromAutoListening?: boolean): Promise<string> {
    if (!isFromAutoListening && (await getRecordFileDurationMs(path)) < 500) {
      console.log("Record audio too short, skipping recognition.");
      return Promise.resolve("");
    }
    console.time(`[ASR time]`);
    const result = await recognizeAudio(path);
    console.timeEnd(`[ASR time]`);
    return result;
  }

  partialThinkingCallback = (partialThinking: string): void => {
    this.partialThinking += partialThinking;
    const { sentences, remaining } = splitSentences(this.partialThinking);
    if (sentences.length > 0) {
      this.thinkingSentences.push(...sentences);
      const displayText = this.thinkingSentences.join(" ");
      display({
        status: "Thinking",
        emoji: "🤔",
        text: displayText,
        RGB: "#ff6800", // yellow
        scroll_speed: 6,
      });
    }
    this.partialThinking = remaining;
  };

  transitionTo = (flowName: FlowName): void => {
    if (flowName !== "music" && isMusicPlaying()) {
      stopMusicPlayback();
    }
    console.log(`[${getCurrentTimeTag()}] switch to:`, flowName);
    this.stateMachine.transitionTo(flowName);
    display({ text_input_enabled: flowName === "sleep" });
  };

  isAnswerFlow = (): boolean => {
    return (
      this.currentFlowName === "answer" ||
      this.currentFlowName === "external_answer"
    );
  };

  composeAnswerDisplayText = (text?: string): string => {
    const answerText = text ?? this.answerDisplayText;
    if (this.toolDisplayItems.length === 0) {
      return answerText || "";
    }
    const sortedItems = [...this.toolDisplayItems].sort((a, b) => {
      if (a.anchorIndex !== b.anchorIndex) {
        return a.anchorIndex - b.anchorIndex;
      }
      return a.startedAt - b.startedAt;
    });
    let result = "";
    let cursor = 0;
    sortedItems.forEach((item) => {
      const anchorIndex = Math.min(Math.max(item.anchorIndex, 0), answerText.length);
      if (anchorIndex > cursor) {
        result += answerText.slice(cursor, anchorIndex);
        cursor = anchorIndex;
      }
      const needsSeparatorBefore =
        result.length > 0 && !/[\s\n]$/.test(result);
      const needsSeparatorAfter =
        anchorIndex < answerText.length && !/^[\s\n]/.test(answerText.slice(anchorIndex));
      result += `${needsSeparatorBefore ? " " : ""}{tool:${item.id}}${needsSeparatorAfter ? " " : ""}`;
    });
    result += answerText.slice(cursor);
    return result;
  };

  private formatToolDisplayItem = (item: {
    name: string;
    elapsedSeconds?: number;
  }): string =>
    item.elapsedSeconds && item.elapsedSeconds >= 10
      ? `% ${item.name} ${item.elapsedSeconds}s...`
      : `% ${item.name}...`;

  private refreshToolDisplayText = (): void => {
    this.toolDisplayText = this.toolDisplayItems
      .map((item) => this.formatToolDisplayItem(item))
      .join("");
  };

  private getToolPlaceholders = (): Record<string, string> =>
    Object.fromEntries(
      this.toolDisplayItems.map((item) => [
        item.id,
        this.formatToolDisplayItem(item),
      ]),
    );

  private updateAnswerDisplay = (immediate = false): void => {
    const render = () => {
      this.answerDisplayTimer = undefined;
      if (!this.isAnswerFlow()) return;
      this.lastAnswerDisplayAt = Date.now();
      display({
        status: "answering",
        text: this.composeAnswerDisplayText(),
        tool_placeholders: this.getToolPlaceholders(),
        terminal_text: "",
        scroll_speed: 3,
      });
    };
    if (immediate || Date.now() - this.lastAnswerDisplayAt >= 80) {
      if (this.answerDisplayTimer) {
        clearTimeout(this.answerDisplayTimer);
        this.answerDisplayTimer = undefined;
      }
      render();
      return;
    }
    if (this.answerDisplayTimer) {
      return;
    }
    this.answerDisplayTimer = setTimeout(render, 80);
  };

  updateAnswerDisplayText = (text: string): void => {
    if (!this.isAnswerFlow()) return;
    this.answerDisplayText = text || "";
    this.updateAnswerDisplay();
  };

  appendToolCallDisplay = (functionName: string): void => {
    const item = {
      id: `t${++this.toolDisplaySeq}`,
      name: functionName,
      anchorIndex: this.answerDisplayText.length,
      startedAt: Date.now(),
      elapsedSeconds: undefined as number | undefined,
      timer: undefined as ReturnType<typeof setInterval> | undefined,
    };
    item.timer = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - item.startedAt) / 1000);
      if (elapsedSeconds < 10 || item.elapsedSeconds === elapsedSeconds) {
        return;
      }
      item.elapsedSeconds = elapsedSeconds;
      this.refreshToolDisplayText();
      display({ tool_placeholders: this.getToolPlaceholders() });
    }, 1000);
    this.toolDisplayItems.push(item);
    this.refreshToolDisplayText();
    this.updateAnswerDisplay(true);
  };

  finishToolCallDisplay = (functionName: string): void => {
    const item = [...this.toolDisplayItems]
      .reverse()
      .find((candidate) => candidate.name === functionName && candidate.timer);
    if (!item) {
      this.toolDisplayItems.push({
        id: `t${++this.toolDisplaySeq}`,
        name: functionName,
        anchorIndex: this.answerDisplayText.length,
        startedAt: Date.now(),
        elapsedSeconds: undefined,
        timer: undefined,
      });
      this.refreshToolDisplayText();
      this.updateAnswerDisplay(true);
      return;
    }
    if (item.timer) {
      clearInterval(item.timer);
      item.timer = undefined;
    }
    const elapsedSeconds = Math.floor((Date.now() - item.startedAt) / 1000);
    item.elapsedSeconds = elapsedSeconds >= 10 ? elapsedSeconds : undefined;
    this.refreshToolDisplayText();
    this.updateAnswerDisplay(true);
  };

  keepCommandToolDisplayRunning = (jobId: string): void => {
    const item = [...this.toolDisplayItems]
      .reverse()
      .find((candidate) => candidate.name === "runCommand" && candidate.timer);
    if (!item) {
      return;
    }
    item.backgroundJobId = jobId;
    this.refreshToolDisplayText();
    this.updateAnswerDisplay(true);
  };

  finishCommandToolDisplay = (jobId: string): void => {
    let item = [...this.toolDisplayItems]
      .reverse()
      .find((candidate) => candidate.backgroundJobId === jobId && candidate.timer);
    if (!item) {
      item = [...this.toolDisplayItems]
        .reverse()
        .find((candidate) => candidate.name === "runCommand" && candidate.timer);
    }
    if (!item) {
      return;
    }
    if (item.timer) {
      clearInterval(item.timer);
      item.timer = undefined;
    }
    const elapsedSeconds = Math.floor((Date.now() - item.startedAt) / 1000);
    item.elapsedSeconds = elapsedSeconds >= 10 ? elapsedSeconds : undefined;
    this.refreshToolDisplayText();
    this.updateAnswerDisplay(true);
  };

  resetToolCallDisplay = (): void => {
    this.toolDisplayItems.forEach((item) => {
      if (item.timer) {
        clearInterval(item.timer);
      }
    });
    if (this.answerDisplayTimer) {
      clearTimeout(this.answerDisplayTimer);
      this.answerDisplayTimer = undefined;
    }
    this.toolDisplayItems = [];
    this.toolDisplayText = "";
    this.toolDisplaySeq = 0;
    this.lastAnswerDisplayAt = 0;
  };

  streamExternalReply = async (text: string, emoji?: string): Promise<void> => {
    if (!text) {
      this.streamResponser.endPartial();
      return;
    }
    if (emoji) {
      display({
        status: "answering",
        emoji,
        scroll_speed: 3,
      });
    }
    const { sentences, remaining } = splitSentences(text);
    const parts = [...sentences];
    if (remaining.trim()) {
      parts.push(remaining);
    }
    for (const part of parts) {
      this.streamResponser.partial(part);
      this.updateAnswerDisplayText(`${this.answerDisplayText}${part}`);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    this.streamResponser.endPartial();
  };

  startWakeSession = (): void => {
    this.wakeSessionActive = true;
    this.wakeSessionStartAt = Date.now();
    this.wakeSessionLastSpeechAt = this.wakeSessionStartAt;
    this.endAfterAnswer = false;
    playWakeupChime();
    this.transitionTo("wake_listening");
  };

  endWakeSession = (): void => {
    this.wakeSessionActive = false;
    this.endAfterAnswer = false;
  };

  shouldContinueWakeSession = (): boolean => {
    if (!this.wakeSessionActive) return false;
    const last = this.wakeSessionLastSpeechAt || this.wakeSessionStartAt;
    return Date.now() - last < this.wakeSessionIdleTimeoutMs;
  };

  shouldEndAfterAnswer = (text: string): boolean => {
    const lower = text.toLowerCase();
    return this.wakeEndKeywords.some(
      (keyword) => keyword && lower.includes(keyword),
    );
  };
}

export default ChatFlow;
