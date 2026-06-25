import { StreamResponser } from "../StreamResponsor";
import type { WhisplayIMApprovalRequest } from "../../device/im-bridge";

export type FlowName =
  | "sleep"
  | "camera"
  | "music"
  | "listening"
  | "wake_listening"
  | "asr"
  | "answer"
  | "image"
  | "approval"
  | "external_answer";

export type FlowStateHandler = (ctx: ChatFlowContext) => void;

export interface ChatFlowContext {
  currentFlowName: FlowName;
  recordingsDir: string;
  currentRecordFilePath: string;
  asrText: string;
  streamResponser: StreamResponser;
  partialThinking: string;
  thinkingSentences: string[];
  answerId: number;
  enableCamera: boolean;
  knowledgePrompts: string[];
  wakeSessionActive: boolean;
  wakeSessionStartAt: number;
  wakeSessionLastSpeechAt: number;
  wakeSessionIdleTimeoutMs: number;
  wakeRecordMaxSec: number;
  wakeEndKeywords: string[];
  endAfterAnswer: boolean;
  pendingExternalReply: string;
  pendingExternalEmoji: string;
  pendingExternalImageUrl: string;
  pendingApprovalRequest: WhisplayIMApprovalRequest | null;
  currentExternalEmoji: string;
  isFromWakeListening: boolean;
  enterMusicAfterAnswer: boolean;
  musicDisplayText: string;
  toolDisplayText: string;
  answerDisplayText: string;

  transitionTo: (flowName: FlowName) => void;
  composeAnswerDisplayText: (text?: string) => string;
  updateAnswerDisplayText: (text: string) => void;
  appendToolCallDisplay: (functionName: string) => void;
  finishToolCallDisplay: (functionName: string) => void;
  resetToolCallDisplay: () => void;
  recognizeAudio: (path: string, isFromAutoListening?: boolean) => Promise<string>;
  partialThinkingCallback: (partialThinking: string) => void;
  startWakeSession: () => void;
  endWakeSession: () => void;
  shouldContinueWakeSession: () => boolean;
  shouldEndAfterAnswer: (text: string) => boolean;
  streamExternalReply: (text: string, emoji?: string) => Promise<void>;
}
