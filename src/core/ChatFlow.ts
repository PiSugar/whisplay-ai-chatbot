import { getCurrentTimeTag } from './../utils/index';
import { noop } from "lodash";
import { onButtonPressed, onButtonReleased, display } from "../device/display";
import { recordAudioManually, StreamResponser } from "../device/audio";
import {
  recognizeAudio,
  chatWithLLMStream,
  ttsProcessor,
} from "../cloud-api/server";
import { extractEmojis } from "../utils";

interface ChatFlowConstructor {
  dataDir: string;
}

class ChatFlow {
  currentFlowName: string = "";
  dataDir: string = "";
  currentRecordFilePath: string = "";
  asrText: string = "";
  streamResponser: StreamResponser;

  constructor({ dataDir }: ChatFlowConstructor) {
    console.log(`[${getCurrentTimeTag()}] ChatBot started.`);
    this.dataDir = dataDir;
    this.setCurrentFlow("sleep");
    this.streamResponser = new StreamResponser(
      ttsProcessor,
      (sentences: string[]) => {
        if (this.currentFlowName !== "answer") return;
        const fullText = sentences.join("");
        display({
          status: "answering",
          emoji: extractEmojis(fullText) || "😊",
          text: fullText,
          RGB: "#0000ff",
        });
      },
      (text: string) => {
        if (this.currentFlowName !== "answer") return;
        display({
          text,
        });
      }
    );
  }

  setCurrentFlow = (flowName: string): void => {
    console.log(`[${getCurrentTimeTag()}] switch to:`, flowName);
    switch (flowName) {
      case "sleep":
        this.currentFlowName = "sleep";
        onButtonPressed(() => {
          this.setCurrentFlow("listening");
        });
        onButtonReleased(noop);
        display({
          status: "idle",
          emoji: "😴",
          RGB: "#000055",
          text: "Press the button to start",
        });
        break;
      case "listening":
        this.currentFlowName = "listening";
        this.currentRecordFilePath = `${this.dataDir}/user-${Date.now()}.mp3`;
        onButtonPressed(noop);
        const { result, stop } = recordAudioManually(
          this.currentRecordFilePath
        );
        onButtonReleased(() => {
          stop();
          display({
            RGB: "#ff6800", // yellow
          });
        });
        result.then(() => {
          this.setCurrentFlow("asr");
        });
        display({
          status: "listening",
          emoji: "😐",
          RGB: "#00ff00",
          text: "Listening...",
        });
        break;
      case "asr":
        this.currentFlowName = "asr";
        display({
          status: "recognizing",
        });
        Promise.race([
          recognizeAudio(this.currentRecordFilePath),
          new Promise<string>((resolve) => {
            onButtonPressed(() => {
              resolve("[UserPress]");
            });
            onButtonReleased(noop);
          }),
        ]).then((result) => {
          if (result === "[UserPress]") {
            this.setCurrentFlow("listening");
          } else {
            if (result) {
              console.log("识别结果:", result);
              this.asrText = result;
              this.setCurrentFlow("answer");
              display({ status: "recognizing", text: result });
            } else {
              this.setCurrentFlow("sleep");
            }
          }
        });
        break;
      case "answer":
        this.currentFlowName = "answer";
        onButtonPressed(() => {
          this.setCurrentFlow("listening");
        });
        onButtonReleased(noop);
        const {
          partial,
          endPartial,
          getPlayEndPromise,
          stop: stopPlaying,
        } = this.streamResponser;
        chatWithLLMStream(
          [
            {
              role: "user",
              content: this.asrText,
            },
          ],
          partial,
          endPartial
        );
        getPlayEndPromise().then(() => {
          if (this.currentFlowName === "answer") {
            this.setCurrentFlow("sleep");
          }
        });
        onButtonPressed(() => {
          stopPlaying();
          this.setCurrentFlow("listening");
        });
        onButtonReleased(noop);
        break;
      default:
        console.error("Unknown flow name:", flowName);
        break;
    }
  };
}

export default ChatFlow;
