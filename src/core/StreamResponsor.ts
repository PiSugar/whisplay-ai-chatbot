import { purifyTextForTTS, splitSentences } from "../utils";
import dotenv from "dotenv";
import { playAudioData, stopPlaying } from "../device/audio";

dotenv.config();

type TTSFunc = (text: string) => Promise<{ data: Buffer; duration: number }>;
type SentencesCallback = (sentences: string[]) => void;
type TextCallback = (text: string) => void;

export class StreamResponser {
  private ttsFunc: TTSFunc;
  private sentencesCallback?: SentencesCallback;
  private textCallback?: TextCallback;
  private partialContent: string = "";
  private isStartSpeak: boolean = false;
  private playEndResolve: () => void = () => {};
  private speakArray: Promise<{
    data: Buffer;
    duration: number;
  }>[] = [];
  private parsedSentences: string[] = [];
  private answerId: number = 0;

  constructor(
    ttsFunc: TTSFunc,
    sentencesCallback?: SentencesCallback,
    textCallback?: TextCallback
  ) {
    this.ttsFunc = (text) => ttsFunc(text);
    this.sentencesCallback = sentencesCallback;
    this.textCallback = textCallback;
  }

  private playAudioInOrder = async (): Promise<void> => {
    let currentIndex = 0;
    const playNext = async () => {
      if (currentIndex < this.speakArray.length) {
        try {
          const { data: audio, duration } = await this.speakArray[currentIndex];
          console.log(
            `Playing audio ${currentIndex + 1}/${this.speakArray.length}`
          );
          await playAudioData(audio, duration);
        } catch (error) {
          console.error("Audio playback error:", error);
        }
        currentIndex++;
        playNext();
      } else if (this.partialContent) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        playNext();
      } else {
        console.log(
          `Play all audio completed. Total: ${this.speakArray.length}`
        );
        this.playEndResolve();
        this.isStartSpeak = false;
        this.speakArray.length = 0;
        this.speakArray = [];
      }
    };
    playNext();
  };

  partial = (text: string): void => {
    this.partialContent += text;
    // replace newlines with spaces
    this.partialContent = this.partialContent.replace(/\n/g, " ");
    const { sentences, remaining } = splitSentences(this.partialContent);
    if (sentences.length > 0) {
      this.parsedSentences.push(...sentences);
      this.sentencesCallback?.(this.parsedSentences);
      // remove emoji
      const filteredSentences = sentences
        .map(purifyTextForTTS)
        .filter((item) => item !== "");
      this.speakArray.push(
        ...filteredSentences.map((item) =>
          this.ttsFunc(item).finally(() => {
            if (!this.isStartSpeak) {
              this.playAudioInOrder();
              this.isStartSpeak = true;
            }
          })
        )
      );
    }
    this.partialContent = remaining;
  };

  endPartial = (): void => {
    if (this.partialContent) {
      this.parsedSentences.push(this.partialContent);
      this.sentencesCallback?.(this.parsedSentences);
      // remove emoji
      this.partialContent = this.partialContent.replace(
        /[\u{1F600}-\u{1F64F}]/gu,
        ""
      );
      if (this.partialContent.trim() !== "") {
        const text = purifyTextForTTS(this.partialContent);
        this.speakArray.push(
          this.ttsFunc(text).finally(() => {
            if (!this.isStartSpeak) {
              this.playAudioInOrder();
              this.isStartSpeak = true;
            }
          })
        );
      }
      this.partialContent = "";
    }
    this.textCallback?.(this.parsedSentences.join(" "));
    this.parsedSentences.length = 0;
  };

  getPlayEndPromise = (): Promise<void> => {
    return new Promise((resolve) => {
      this.playEndResolve = resolve;
    });
  };

  stop = (): void => {
    this.speakArray = [];
    this.speakArray.length = 0;
    this.isStartSpeak = false;
    this.partialContent = "";
    this.parsedSentences.length = 0;
    this.playEndResolve();
    this.answerId = 0;
    stopPlaying();
  };
}
