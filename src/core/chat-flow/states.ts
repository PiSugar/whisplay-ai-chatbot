import moment from "moment";
import { compact, noop } from "lodash";
import { performance } from "node:perf_hooks";
import {
  onButtonPressed,
  onButtonReleased,
  onButtonDoubleClick,
  display,
  getCurrentStatus,
  onCameraCapture,
  onCameraModeRequest,
  onCameraShutterRequest,
  onCameraBackRequest,
  onTextInput,
  isButtonDown,
} from "../../device/display";
import {
  recordAudio,
  recordAudioManually,
  recordFileFormat,
  getDynamicVoiceDetectLevel,
  canStreamRecording,
  waitForPlaybackToStop,
  playWakeupChime,
} from "../../device/audio";
import { chatWithLLMStream, startRecordingStream } from "../../cloud-api/server";
import { isImMode, summaryTextWithLLM } from "../../cloud-api/llm";
import { getSystemPromptWithKnowledge } from "../Knowledge";
import { enableRAG } from "../../cloud-api/knowledge";
import { cameraDir } from "../../utils/dir";
import {
  clearPendingCapturedImgForChat,
  getLatestGenImg,
  getLatestDisplayImg,
  setLatestCapturedImg,
  setPendingCapturedImgForChat,
} from "../../utils/image";
import { sendWhisplayIMMessage } from "../../cloud-api/whisplay-im/whisplay-im";
import { ChatFlowContext, FlowName, FlowStateHandler } from "./types";
import {
  enterCameraMode,
  captureCameraImage,
  exitCameraMode,
  handleCameraModePress,
  handleCameraModeRelease,
  onCameraModeExit,
  resetCameraModeControl,
} from "./camera-mode";
import { DEFAULT_EMOJI } from "../../utils";
import { isMusicPlaying, getCurrentTrackTitle, stopMusicPlayback, startPendingMusicPlayback, onMusicTrackChange, onMusicPlaybackEnd } from "../../device/music-player";
import { autoSaveExchange, prepareMemoryPrompt } from "../../config/local-memory";
import { detectHatModel } from "../../utils/hat-detect";
import { VOICE_PCM_SAMPLE_RATE } from "../../utils/pcm-wav";

const isHatPlus = detectHatModel() === "hat-plus";
const MIN_PUSH_TO_TALK_MS = 500;
const STREAM_FINAL_TIMEOUT_MS = 3000;
// The streaming capture is mono signed 16-bit PCM.
const MIN_CAPTURE_BYTES = VOICE_PCM_SAMPLE_RATE * 2 * MIN_PUSH_TO_TALK_MS / 1000;

const listenFromButton = (ctx: ChatFlowContext): void => {
  if (ctx.autoListeningEnabled) ctx.startWakeSession(true);
  else ctx.transitionTo("listening");
};

export const flowStates: Record<FlowName, FlowStateHandler> = {
  sleep: (ctx: ChatFlowContext) => {
    onButtonPressed(async () => {
      resetCameraModeControl();
      // Stop any playing music when waking up
      stopMusicPlayback();
      if (ctx.autoListeningEnabled) {
        listenFromButton(ctx);
        return;
      }
      await ctx.pauseWakeWordListener();
      if (ctx.currentFlowName !== "sleep") return;
      ctx.transitionTo("listening");
    });
    onButtonReleased(noop);
    onCameraModeExit(null);
    onCameraShutterRequest(null);
    onCameraBackRequest(null);
    onTextInput(async (text: string) => {
      if (ctx.currentFlowName !== "sleep") return;
      await ctx.pauseWakeWordListener();
      if (ctx.currentFlowName !== "sleep") return;
      ctx.answerId += 1;
      ctx.asrText = text;
      display({ status: "recognizing", text, text_input_enabled: false });
      ctx.transitionTo("answer");
    });
    if (ctx.enableCamera) {
      const openCamera = async () => {
        await ctx.pauseWakeWordListener();
        if (ctx.currentFlowName !== "sleep") return;
        const captureImgPath = `${cameraDir}/capture-${moment().format(
          "YYYYMMDD-HHmmss",
        )}.jpg`;
        enterCameraMode(captureImgPath);
        ctx.transitionTo("camera");
      };
      onCameraModeRequest(openCamera);
      if (isHatPlus || ctx.autoListeningEnabled) {
        onButtonDoubleClick(null);
      } else {
        onButtonDoubleClick(openCamera);
      }
    } else {
      onCameraModeRequest(null);
      onButtonDoubleClick(null);
    }
    const status = getCurrentStatus();
    display({
      status: "idle",
      emoji: "😴",
      RGB: "#000055",
      rag_icon_visible: false,
      ...(status.status === "detecting" || status.status === "listening" ||
        status.text.endsWith("Listening...") ||
        status.text.startsWith("Long Press the button") ||
        status.text === "Press the button to start listening." || !status.text
        ? {
          text: ctx.autoListeningEnabled ? "Press the button to start listening." :
            `Long Press the button to say something${ctx.enableCamera && !isHatPlus ? ",\ndouble click to launch camera" : ""}.`,
        }
        : {}),
    });
  },
  camera: (ctx: ChatFlowContext) => {
    onButtonDoubleClick(null);
    onCameraModeRequest(null);
    onButtonPressed(() => {
      handleCameraModePress();
    });
    onButtonReleased(() => {
      handleCameraModeRelease();
    });
    onCameraShutterRequest(() => {
      captureCameraImage();
    });
    onCameraBackRequest(() => {
      exitCameraMode();
    });
    onCameraCapture(() => {
      const captureImagePath = getCurrentStatus().capture_image_path;
      if (!captureImagePath) {
        return;
      }
      setLatestCapturedImg(captureImagePath);
      setPendingCapturedImgForChat(captureImagePath);
      display({ image_icon_visible: true });
    });
    onCameraModeExit(() => {
      if (ctx.currentFlowName === "camera") {
        ctx.transitionTo("sleep");
      }
    });
    display({
      status: "camera",
      emoji: "📷",
      RGB: "#00ff88",
    });
  },
  music: (ctx: ChatFlowContext) => {
    // Start deferred music playback when entering music state
    startPendingMusicPlayback();

    // Update display when track changes during continuous playback
    onMusicTrackChange((title) => {
      if (ctx.currentFlowName === "music") {
        display({ text: `Now playing: ${title}` });
      }
    });

    // Return to sleep when non-continuous playback finishes
    onMusicPlaybackEnd(() => {
      if (ctx.currentFlowName === "music") {
        onMusicTrackChange(null);
        onMusicPlaybackEnd(null);
        ctx.transitionTo("sleep");
      }
    });

    onButtonDoubleClick(null);
    onButtonPressed(() => {
      // Stop music immediately when button is pressed
      onMusicTrackChange(null);
      onMusicPlaybackEnd(null);
      stopMusicPlayback();
      listenFromButton(ctx);
    });
    onButtonReleased(noop);

    const trackTitle = getCurrentTrackTitle();
    display({
      status: "music",
      emoji: "🎹",
      RGB: "#0066aa",
      text:
        ctx.musicDisplayText ||
        (isMusicPlaying() && trackTitle
          ? `Now playing: ${trackTitle}`
          : "Music mode. Press the button to talk."),
      rag_icon_visible: false,
    });
  },
  listening: async (ctx: ChatFlowContext) => {
    ctx.enterMusicAfterAnswer = false;
    ctx.musicDisplayText = "";
    ctx.isFromWakeListening = false;
    ctx.answerId += 1;
    ctx.endWakeSession();
    onButtonDoubleClick(null);
    ctx.currentRecordFilePath = `${ctx.recordingsDir
      }/user-${Date.now()}.${recordFileFormat}`;
    onButtonPressed(noop);
    let releasedBeforeCapture = false;
    onButtonReleased(() => { releasedBeforeCapture = true; });
    const listeningStartedAt = performance.now();
    const turn = ctx.answerId;
    const playbackClosed = waitForPlaybackToStop();
    if (playbackClosed || ctx.autoCapture) await Promise.all([playbackClosed, ctx.autoCapture?.closed]);
    if (ctx.answerId !== turn || ctx.currentFlowName !== "listening") return;
    // If button was already released before we entered this state, go back to sleep
    if (releasedBeforeCapture || !isButtonDown()) {
      console.log("[listening] Button already released, returning to sleep");
      ctx.transitionTo("sleep");
      return;
    }
    let releasedAt: number | undefined;
    const stream = canStreamRecording() ? startRecordingStream?.((text) => {
      if (ctx.answerId !== turn || ctx.currentFlowName !== "listening" || releasedAt !== undefined) return;
      display({ text: text || "Listening..." });
    }) : undefined;
    let capturedBytes = 0;
    const { result, stop } = recordAudioManually(
      ctx.currentRecordFilePath, stream ? (chunk) => {
        capturedBytes += chunk.length;
        stream.write(chunk);
      } : undefined,
    );
    if (stream) {
      const isCurrentTurn = () => ctx.answerId === turn && ctx.currentFlowName === "asr";
      ctx.recordingRecognition = {
        async resolve() {
          // Let the recorder deliver the last PCM frame before asking for the transcript.
          const path = await result;
          if (!isCurrentTurn() || capturedBytes < MIN_CAPTURE_BYTES) return "";
          const remainingMs = STREAM_FINAL_TIMEOUT_MS - (performance.now() - (releasedAt ?? listeningStartedAt));
          const text = await stream.finish(remainingMs);
          if (!isCurrentTurn()) return "";
          return text ?? ctx.recognizeAudio(path);
        },
        cancel: () => {
          stream.cancel();
          if (releasedAt === undefined) stop();
        },
      };
    }
    const handleRelease = () => {
      if (releasedAt !== undefined) return;
      releasedAt = performance.now();
      if (releasedAt - listeningStartedAt < MIN_PUSH_TO_TALK_MS) {
        // Too short to be meaningful — stop recording and return to sleep
        console.log("[listening] Button released too quickly, returning to sleep");
        stop();
        ctx.transitionTo("sleep");
        return;
      }
      stop();
      display({
        RGB: "#ff6800",
        image: "",
      });
      if (stream) ctx.transitionTo("asr");
    };
    onButtonReleased(handleRelease);
    result
      .then(() => {
        if (ctx.answerId === turn && ctx.currentFlowName === "listening") {
          if (stream && releasedAt === undefined) {
            ctx.transitionTo("sleep");
          } else {
            ctx.transitionTo("asr");
          }
        }
      })
      .catch((err) => {
        console.error("Error during recording:", err);
        if (ctx.answerId === turn && ctx.currentFlowName === "listening") ctx.transitionTo("sleep");
      });
    display({
      status: "listening",
      emoji: DEFAULT_EMOJI,
      RGB: "#00ff00",
      text: "Listening...",
      rag_icon_visible: false,
    });
  },
  wake_listening: (ctx: ChatFlowContext) => {
    ctx.enterMusicAfterAnswer = false;
    ctx.musicDisplayText = "";
    ctx.isFromWakeListening = true;
    const turn = ++ctx.answerId;
    const previousCapture = ctx.autoCapture?.closed;
    const chime = ctx.wakeChimePending;
    ctx.wakeChimePending = false;
    const controller = new AbortController();
    const endpoint = new AbortController();
    let stream: ReturnType<NonNullable<typeof startRecordingStream>>;
    const cancelStream = () => {
      stream?.cancel();
      stream = undefined;
    };
    let hasPcm = false;
    const isCurrent = () => !controller.signal.aborted &&
      ctx.answerId === turn && ctx.currentFlowName === "wake_listening";
    onButtonDoubleClick(null);
    onButtonPressed(() => {
      if (ctx.autoListeningEnabled) {
        ctx.endWakeSession();
        ctx.transitionTo("sleep");
      } else {
        ctx.transitionTo("listening");
      }
    });
    onButtonReleased(noop);
    display({
      status: "detecting",
      emoji: DEFAULT_EMOJI,
      RGB: "#00ff00",
      text: "Detecting voice level...",
      rag_icon_visible: false,
    });
    const capture = async (): Promise<string | undefined> => {
      await Promise.all([previousCapture, ctx.pauseWakeWordListener(), waitForPlaybackToStop()]);
      if (!isCurrent()) return;
      if (chime) await playWakeupChime();
      if (!isCurrent()) return;
      const level = await getDynamicVoiceDetectLevel();
      if (!isCurrent()) return;
      display({
        status: "listening",
        emoji: DEFAULT_EMOJI,
        RGB: "#00ff00",
        text: `(Detect level: ${level}%) Listening...`,
        rag_icon_visible: false,
      });
      const path = `${ctx.recordingsDir}/user-${Date.now()}.${recordFileFormat}`;
      if (canStreamRecording()) {
        stream = startRecordingStream?.(
          text => { if (isCurrent()) display({ text: text || "Listening..." }); },
          () => { if (isCurrent()) endpoint.abort(); },
        );
      }
      return recordAudio(path, ctx.wakeRecordMaxSec, level, controller.signal, stream ? chunk => {
        if (!isCurrent()) return;
        hasPcm = true;
        stream?.write(chunk);
      } : undefined, endpoint.signal);
    };
    const result = capture();
    const task = ctx.autoCapture = {
      cancel: () => {
        controller.abort();
        cancelStream();
      },
      closed: result.then(noop, noop),
    };
    void task.closed.then(() => {
      if (ctx.autoCapture === task) ctx.autoCapture = undefined;
    });
    void result.then((path) => {
      if (!path || !isCurrent()) {
        cancelStream();
        return;
      }
      ctx.currentRecordFilePath = path;
      if (stream && hasPcm) {
        const recognition = stream;
        stream = undefined;
        const isCurrentTurn = () => ctx.answerId === turn && ctx.currentFlowName === "asr";
        ctx.recordingRecognition = {
          async resolve() {
            const text = await recognition.finish(STREAM_FINAL_TIMEOUT_MS);
            if (!isCurrentTurn()) return "";
            return text ?? ctx.recognizeAudio(path, true);
          },
          cancel: () => recognition.cancel(),
        };
      } else {
        cancelStream();
      }
      ctx.transitionTo("asr");
    }, (error) => {
      cancelStream();
      if (!isCurrent()) return;
      console.error("Error during auto recording:", error);
      ctx.endWakeSession();
      ctx.transitionTo("sleep");
    });
  },
  asr: (ctx: ChatFlowContext) => {
    const turn = ctx.answerId;
    const interrupted = Symbol("recording interrupted");
    display({
      status: "recognizing",
    });
    onButtonDoubleClick(null);
    Promise.race([
      ctx.recordingRecognition?.resolve() ?? ctx.recognizeAudio(ctx.currentRecordFilePath, ctx.isFromWakeListening),
      new Promise<typeof interrupted>((resolve) => {
        onButtonPressed(() => {
          resolve(interrupted);
        });
        onButtonReleased(noop);
      }),
    ]).then((result) => {
      if (ctx.currentFlowName !== "asr" || ctx.answerId !== turn) return;
      if (result === interrupted) {
        listenFromButton(ctx);
        return;
      }
      if (result) {
        console.log("Audio recognized result:", result);
        ctx.asrText = result;
        if (ctx.shouldEndAutoListening(result)) {
          ctx.endWakeSession();
          display({ text: "Press the button to start listening." });
          ctx.transitionTo("sleep");
          return;
        }
        ctx.endAfterAnswer = ctx.shouldEndAfterAnswer(result);
        if (ctx.wakeSessionActive) {
          ctx.wakeSessionLastSpeechAt = Date.now();
        }
        display({ status: "recognizing", text: result });
        ctx.transitionTo("answer");
        return;
      }
      if (ctx.wakeSessionActive) {
        if (ctx.shouldContinueWakeSession()) {
          ctx.transitionTo("wake_listening");
        } else {
          ctx.endWakeSession();
          ctx.transitionTo("sleep");
        }
        return;
      }
      ctx.transitionTo("sleep");
    }).catch((error) => {
      console.error("Error during recognition:", error);
      if (ctx.currentFlowName === "asr" && ctx.answerId === turn) {
        ctx.endWakeSession();
        ctx.transitionTo("sleep");
      }
    });
  },
  answer: (ctx: ChatFlowContext) => {
    ctx.enterMusicAfterAnswer = false;
    ctx.musicDisplayText = "";
    ctx.resetToolCallDisplay();
    ctx.answerDisplayText = "";
    display({
      status: "answering...",
      RGB: "#00c8a3",
    });
    const currentAnswerId = ctx.answerId;
    const isCurrentAnswer = (): boolean =>
      currentAnswerId === ctx.answerId && ctx.currentFlowName === "answer";
    if (isImMode) {
      onButtonPressed(() => listenFromButton(ctx));
      onButtonReleased(noop);
      const prompt: {
        role: "system" | "user";
        content: string;
      }[] = [
          {
            role: "user",
            content: ctx.asrText,
          },
        ];
      sendWhisplayIMMessage(prompt)
        .then((ok) => {
          if (!isCurrentAnswer()) return;
          if (ok) {
            display({
              status: "idle",
              emoji: "😊",
              RGB: "#000055",
              image_icon_visible: false,
            });
          } else {
            display({
              status: "error",
              emoji: "⚠️",
              text: "OpenClaw send failed",
              image_icon_visible: false,
            });
          }
        })
        .finally(() => {
          if (!isCurrentAnswer()) return;
          clearPendingCapturedImgForChat();
          ctx.transitionTo("sleep");
        });
      return;
    }
    const {
      partial,
      endPartial,
      getPlayEndPromise,
      stop: stopPlaying,
    } = ctx.streamResponser;
    let llmResponseText = "";
    const trackingPartial = (text: string): void => {
      if (!isCurrentAnswer()) return;
      llmResponseText += text;
      partial(text);
      ctx.updateAnswerDisplayText(llmResponseText);
    };
    let resolveLlmDone: () => void = () => {};
    const llmDonePromise = new Promise<void>((resolve) => {
      resolveLlmDone = resolve;
    });
    ctx.partialThinking = "";
    ctx.thinkingSentences = [];
    Promise.all([
      [() => Promise.resolve().then(() => ""), getSystemPromptWithKnowledge]
      [enableRAG ? 1 : 0](ctx.asrText),
      Promise.resolve().then(() => prepareMemoryPrompt(ctx.asrText)),
    ])
      .then(([res, memoryPrompt]: [string, string]) => {
        if (!isCurrentAnswer()) return;
        let knowledgePrompt = res;
        if (res) {
          console.log("Retrieved knowledge for RAG:\n", res);
        }
        if (ctx.knowledgePrompts.includes(res)) {
          console.log(
            "[RAG] Knowledge prompt already used in this session, skipping to avoid repetition.",
          );
          knowledgePrompt = "";
        }
        if (knowledgePrompt) {
          ctx.knowledgePrompts.push(knowledgePrompt);
        }
        display({
          rag_icon_visible: Boolean(enableRAG && knowledgePrompt),
        });
        const prompt: {
          role: "system" | "user";
          content: string;
        }[] = compact([
          memoryPrompt
            ? {
              role: "system",
              content: memoryPrompt,
            }
            : null,
          knowledgePrompt
            ? {
              role: "system",
              content: knowledgePrompt,
            }
            : null,
          {
            role: "user",
            content: ctx.asrText,
          },
        ]);
        chatWithLLMStream(
          prompt,
          trackingPartial,
          () => {
            if (isCurrentAnswer()) {
              endPartial();
            }
            resolveLlmDone();
          },
          (partialThinking) =>
            isCurrentAnswer() &&
            ctx.partialThinkingCallback(partialThinking),
          (functionName: string, result?: string) => {
            if (!isCurrentAnswer()) return;
            if (
              functionName === "endConversation" &&
              result?.startsWith("[success]")
            ) {
              ctx.endAfterAnswer = true;
            }
            if (
              functionName === "generateImage" &&
              result?.startsWith("[success]")
            ) {
              const img = getLatestGenImg();
              if (img) {
                display({ image: img });
              }
            }
            if (
              functionName.startsWith("playMusic") &&
              result?.startsWith("[success]")
            ) {
              ctx.enterMusicAfterAnswer = true;
              ctx.musicDisplayText = result.replace(/^\[success\]/, "").trim();
            }
            if (!result) {
              ctx.appendToolCallDisplay(functionName);
            } else if (
              functionName === "runCommand" &&
              result.startsWith("[success] status=running")
            ) {
              const jobId = result.match(/\bjob_id=([^\s]+)/)?.[1];
              if (jobId) {
                ctx.keepCommandToolDisplayRunning(jobId);
              } else {
                ctx.finishToolCallDisplay(functionName);
              }
            } else if (
              result.includes("status=completed")
            ) {
              const jobId = result.match(/\bjob_id=([^\s]+)/)?.[1];
              if (jobId) {
                ctx.finishCommandToolDisplay(jobId);
              }
              ctx.finishToolCallDisplay(functionName);
            } else {
              ctx.finishToolCallDisplay(functionName);
            }
          },
        ).catch((error) => {
          console.error("[answer] LLM stream failed:", error);
          if (isCurrentAnswer()) {
            endPartial();
          }
          resolveLlmDone();
        });
      })
      .catch((error) => {
        console.error("[answer] Failed to prepare prompt:", error);
        if (isCurrentAnswer()) {
          resolveLlmDone();
          ctx.transitionTo("sleep");
        }
      });
    llmDonePromise.then(() => isCurrentAnswer() ? getPlayEndPromise() : undefined).then(() => {
      if (isCurrentAnswer()) {
        autoSaveExchange(ctx.asrText, llmResponseText, summaryTextWithLLM);
        clearPendingCapturedImgForChat();
        display({ image_icon_visible: false });
        if (ctx.wakeSessionActive || ctx.endAfterAnswer) {
          if (ctx.endAfterAnswer) {
            ctx.endWakeSession();
            ctx.transitionTo("sleep");
          } else {
            ctx.transitionTo("wake_listening");
          }
          return;
        }
        if (ctx.enterMusicAfterAnswer) {
          ctx.transitionTo("music");
          return;
        }
        const img = getLatestDisplayImg();
        if (img) {
          ctx.transitionTo("image");
        } else {
          ctx.transitionTo("sleep");
        }
      }
    });
    onButtonPressed(() => {
      stopPlaying();
      clearPendingCapturedImgForChat();
      display({ image_icon_visible: false });
      listenFromButton(ctx);
    });
    onButtonReleased(noop);
  },
  image: (ctx: ChatFlowContext) => {
    onButtonPressed(() => {
      display({ image: "" });
      listenFromButton(ctx);
    });
    onButtonReleased(noop);
  },
  approval: (ctx: ChatFlowContext) => {
    const request = ctx.pendingApprovalRequest;
    if (!request) {
      ctx.transitionTo("sleep");
      return;
    }

    onButtonDoubleClick(null);
    let pressStartedAt = 0;
    let finished = false;
    let timeout: NodeJS.Timeout | null = null;
    const parsedLongPressMs = parseInt(
      process.env.WHISPLAY_IM_APPROVAL_LONG_PRESS_MS || "900",
      10,
    );
    const longPressMs = Number.isFinite(parsedLongPressMs)
      ? Math.max(500, parsedLongPressMs)
      : 900;

    const finish = (approved: boolean): void => {
      if (finished) return;
      finished = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      request.respond(approved);
      ctx.pendingApprovalRequest = null;
      display({
        status: approved ? "Allowed" : "Denied",
        emoji: approved ? "✅" : "⛔",
        text: approved ? "Operation allowed." : "Operation denied.",
        RGB: approved ? "#00c8a3" : "#ff3030",
        approval_mode: false,
        scroll_speed: 0,
      });
      setTimeout(() => {
        if (ctx.currentFlowName === "approval") {
          ctx.transitionTo("sleep");
        }
      }, 600);
    };

    timeout = setTimeout(() => finish(false), request.timeoutMs);
    onButtonPressed(() => {
      pressStartedAt = Date.now();
    });
    onButtonReleased(() => {
      const pressDuration = Date.now() - pressStartedAt;
      finish(pressDuration < longPressMs);
    });

    const lines = compact([
      request.tool ? `[${request.tool}] ${request.title}` : request.title,
      request.text,
    ]);
    display({
      status: "Confirm",
      emoji: "🔐",
      text: lines.join("\n\n"),
      RGB: "#ffb000",
      approval_mode: true,
      text_input_enabled: false,
      scroll_speed: 2,
      image: "",
    });
  },
  external_answer: (ctx: ChatFlowContext) => {
    if (!ctx.pendingExternalReply && !ctx.pendingExternalImageUrl) {
      ctx.transitionTo("sleep");
      return;
    }
    const turn = ++ctx.answerId;
    ctx.resetToolCallDisplay();
    ctx.answerDisplayText = "";
    display({
      status: "answering...",
      RGB: "#00c8a3",
      ...(ctx.pendingExternalEmoji ? { emoji: ctx.pendingExternalEmoji } : {}),
    });
    onButtonPressed(() => {
      ctx.streamResponser.stop();
      display({ image: "" });
      listenFromButton(ctx);
    });
    onButtonReleased(noop);
    const replyText = ctx.pendingExternalReply;
    const replyEmoji = ctx.pendingExternalEmoji;
    const replyImageUrl = ctx.pendingExternalImageUrl;
    ctx.currentExternalEmoji = replyEmoji;
    ctx.pendingExternalReply = "";
    ctx.pendingExternalEmoji = "";
    ctx.pendingExternalImageUrl = "";

    // Display the image if one was provided
    if (replyImageUrl) {
      display({ image: replyImageUrl });
    }

    if (replyText) {
      void ctx.streamExternalReply(replyText, replyEmoji);
      ctx.streamResponser.getPlayEndPromise().then(() => {
        if (ctx.answerId !== turn || ctx.currentFlowName !== "external_answer") return;
        if (ctx.wakeSessionActive || ctx.endAfterAnswer) {
          if (ctx.endAfterAnswer) {
            ctx.endWakeSession();
            ctx.transitionTo("sleep");
          } else {
            ctx.transitionTo("wake_listening");
          }
        } else if (replyImageUrl) {
          // Stay in image display mode after TTS finishes
          ctx.transitionTo("image");
        } else {
          ctx.transitionTo("sleep");
        }
      });
    } else {
      // Image only, no text to speak — go to image display mode
      ctx.transitionTo("image");
    }
  },
};
