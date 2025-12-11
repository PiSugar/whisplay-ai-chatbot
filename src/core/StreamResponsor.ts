import { purifyTextForTTS, splitSentences } from "../utils";
import dotenv from "dotenv";
import { playAudioData, stopPlaying } from "../device/audio";
import { TTSResult } from "../type";

dotenv.config();

type TTSFunc = (text: string) => Promise<TTSResult>;
type SentencesCallback = (sentences: string[]) => void;
type TextCallback = (text: string) => void;

export class StreamResponser {
  private ttsFunc: TTSFunc;
  private sentencesCallback?: SentencesCallback;
  private textCallback?: TextCallback;
  private partialContent: string = "";
  private playEndResolve: () => void = () => {};
  private speakArray: Promise<TTSResult>[] = [];
  private parsedSentences: string[] = [];
  private isPlaying: boolean = false;

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
    // Prevent multiple concurrent calls
    if (this.isPlaying) {
      console.log("Audio playback already in progress, skipping duplicate call");
      return;
    }
    let currentIndex = 0;
    const playNext = async () => {
      if (currentIndex < this.speakArray.length) {
        this.isPlaying = true;
        try {
          const playParams = await this.speakArray[currentIndex];
          console.log(
            `Playing audio ${currentIndex + 1}/${this.speakArray.length}`
          );
          await playAudioData(playParams);
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
        this.isPlaying = false;
        this.playEndResolve();
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
      const length = this.speakArray.length;
      this.speakArray.push(
        ...filteredSentences.map((item, index) =>
          this.ttsFunc(item).finally(() => {
            if (length === 0 && index === 0) {
              this.playAudioInOrder();
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
            if (!this.isPlaying) {
              this.playAudioInOrder();
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
    this.partialContent = "";
    this.parsedSentences.length = 0;
    this.isPlaying = false;
    this.playEndResolve();
    stopPlaying();
  };
}
